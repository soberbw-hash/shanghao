// Exact session inventory and guarded session-volume RPC. Never changes endpoint volume or mute.
using System;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;
using System.Web.Script.Serialization;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class MixEnumeratorClass {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMixDevices { void EnumAudioEndpoints(int flow,uint state,out IMixDeviceCollection devices); }
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMixDeviceCollection { void GetCount(out uint count); void Item(uint index,out IMixDevice device); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMixDevice {
    void Activate(ref Guid iid,uint context,IntPtr parameters,[MarshalAs(UnmanagedType.IUnknown)] out object value);
    void OpenPropertyStore(uint mode,out IntPtr properties);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMixSessionManager {
    void GetAudioSessionControl(IntPtr session,uint flags,out IntPtr control);
    void GetSimpleAudioVolume(IntPtr session,uint flags,out IntPtr volume);
    void GetSessionEnumerator(out IMixSessionEnumerator enumerator);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMixSessionEnumerator {
    void GetCount(out int count);
    void GetSession(int index,[MarshalAs(UnmanagedType.IUnknown)] out object session);
}
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMixSessionControl {
    void GetState(out int state);
    void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name,ref Guid context);
    void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path,ref Guid context);
    void GetGroupingParam(out Guid group); void SetGroupingParam(ref Guid group,ref Guid context);
    void RegisterAudioSessionNotification(IntPtr callback); void UnregisterAudioSessionNotification(IntPtr callback);
    void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    [PreserveSig] int GetProcessId(out uint pid);
    [PreserveSig] int IsSystemSoundsSession();
}
[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IMixSessionVolume {
    void SetMasterVolume(float level,ref Guid context); void GetMasterVolume(out float level);
    void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute,ref Guid context);
    void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
class MixSession {
    public string deviceId, instanceId;
    public uint processId;
    public float volume;
    public bool muted;
}
class MixChange {
    public string deviceId { get; set; }
    public string instanceId { get; set; }
    public uint processId { get; set; }
    public float? expected { get; set; }
    public float? value { get; set; }
    public float? original { get; set; }
}
class ChatMixSessions {
    static readonly Dictionary<string,MixChange> owned=new Dictionary<string,MixChange>();
    static void Release(object value) { if(value!=null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
    static string Key(MixChange change) {
        return new JavaScriptSerializer().Serialize(new object[] {change.deviceId,change.instanceId,change.processId});
    }
    static int Pipe() {
        // Read on a background thread so a stalled/dead parent cannot leave its volumes reduced.
        var input=new BlockingCollection<string>(8);
        var reader=new Thread(delegate() {
            try {
                var line=new StringBuilder(); int next;
                while((next=Console.In.Read())>=0) {
                    if(next=='\n') { input.Add(line.ToString()); line.Length=0; }
                    else if(next!='\r') { if(line.Length>=16384) break; line.Append((char)next); }
                }
            } catch { } finally { input.CompleteAdding(); }
        });
        reader.IsBackground=true; reader.Start();
        var idle=Stopwatch.StartNew();
        try {
            while(!input.IsCompleted) {
                string line;
                if(!input.TryTake(out line,500)) { if(idle.ElapsedMilliseconds>8000) break; continue; }
                idle.Restart();
                try {
                    var json=new JavaScriptSerializer();
                    var request=json.Deserialize<Dictionary<string,object>>(line); object command;
                    if(request!=null && request.TryGetValue("command",out command)) {
                        if((string)command=="list") { Scan("--list",null); continue; }
                        if((string)command=="ping") { Console.WriteLine("{\"ok\":true}"); continue; }
                        throw new Exception();
                    }
                    var change=json.Deserialize<MixChange>(line);
                    if(change==null || change.processId==0 || String.IsNullOrEmpty(change.deviceId) ||
                       String.IsNullOrEmpty(change.instanceId) || change.deviceId.Length>1024 || change.instanceId.Length>4096 ||
                       !change.expected.HasValue || !change.value.HasValue ||
                       Single.IsNaN(change.expected.Value) || Single.IsNaN(change.value.Value) || change.expected<0 || change.expected>1 || change.value<0 || change.value>1 ||
                       (change.original.HasValue && (Single.IsNaN(change.original.Value) || change.original<0 || change.original>1)))
                        throw new Exception();
                    Scan("--change",change);
                } catch { Console.WriteLine("{\"ok\":false,\"error\":\"chat_mix_invalid_command\"}"); }
            }
        } finally {
            // Exact instance + last written value only. Manual changes always win.
            foreach(var lease in new List<MixChange>(owned.Values)) {
                lease.expected=lease.value; lease.value=lease.original;
                Scan("--restore",lease);
            }
        }
        return 0;
    }
    [MTAThread]
    static int Main(string[] args) {
        // Session identifiers can contain Unicode installation paths. Node's pipe is UTF-8.
        Console.InputEncoding=new UTF8Encoding(false,true);
        Console.OutputEncoding=new UTF8Encoding(false);
        if(args.Length==1 && args[0]=="--pipe") {
            return Pipe();
        }
        if(args.Length!=1 || (args[0]!="--list" && args[0]!="--stats")) { Console.Error.WriteLine("chat_mix_invalid_command"); return 2; }
        return Scan(args[0],null);
    }
    static int Scan(string mode,MixChange change) {
        object devices=null; IMixDeviceCollection collection=null;
        var result=new List<MixSession>();
        int endpoints=0, scanned=0, failedEndpoints=0, failedSessions=0;
        bool changed=false,found=false,conflict=false;
        try {
            devices=new MixEnumeratorClass();
            ((IMixDevices)devices).EnumAudioEndpoints(0,1,out collection);
            uint count; collection.GetCount(out count);
            endpoints=(int)count;
            for(uint i=0;i<count && i<64;i++) {
                IMixDevice device=null; object manager=null; IMixSessionEnumerator sessions=null;
                try {
                    collection.Item(i,out device); string deviceId; device.GetId(out deviceId);
                    Guid iid=typeof(IMixSessionManager).GUID; device.Activate(ref iid,23,IntPtr.Zero,out manager);
                    ((IMixSessionManager)manager).GetSessionEnumerator(out sessions);
                    int total; sessions.GetCount(out total);
                    for(int index=0;index<total && index<1024 && result.Count<512;index++) {
                        object session=null;
                        scanned++;
                        try {
                            sessions.GetSession(index,out session); var control=(IMixSessionControl)session;
                            int state; control.GetState(out state);
                            uint pid; int code=control.GetProcessId(out pid);
                            // Multi-process sessions have ambiguous ownership; never use them as background targets.
                            if(state==2 || code!=0 || pid==0 || control.IsSystemSoundsSession()==0) continue;
                            string instance; control.GetSessionInstanceIdentifier(out instance);
                            if(String.IsNullOrEmpty(instance) || instance.Length>4096 || deviceId.Length>1024) continue;
                            var volume=(IMixSessionVolume)session; float level; bool muted;
                            volume.GetMasterVolume(out level); volume.GetMute(out muted);
                            if(change!=null && change.deviceId==deviceId && change.instanceId==instance && change.processId==pid) {
                                found=true;
                                if(Math.Abs(level-change.expected.Value)>.0001f) { conflict=true; owned.Remove(Key(change)); }
                                else {
                                    if(mode=="--change") {
                                        MixChange previous; string id=Key(change);
                                        float original=change.original ?? (owned.TryGetValue(id,out previous) ? previous.original.Value : level);
                                        if(owned.Count>=512 && !owned.ContainsKey(id)) throw new COMException();
                                        owned[id]=new MixChange {deviceId=deviceId,instanceId=instance,processId=pid,original=original,value=change.value};
                                    }
                                    Guid context=new Guid("BA21BC76-47EF-4BB7-B27F-C277903E053D");
                                    volume.SetMasterVolume(change.value.Value,ref context);
                                    volume.GetMasterVolume(out level);
                                    changed=Math.Abs(level-change.value.Value)<=.0001f;
                                    MixChange tracked;
                                    if(changed && owned.TryGetValue(Key(change),out tracked) && Math.Abs(level-tracked.original.Value)<=.0001f) owned.Remove(Key(change));
                                }
                            }
                            result.Add(new MixSession { deviceId=deviceId,instanceId=instance,processId=pid,volume=level,muted=muted });
                        } catch(COMException) { failedSessions++; }
                        finally { Release(session); }
                    }
                } catch(COMException) { failedEndpoints++; }
                finally { Release(sessions); Release(manager); Release(device); }
            }
            var json=new JavaScriptSerializer();
            if(mode=="--restore") return 0;
            Console.WriteLine(mode=="--change" ? json.Serialize(new { ok=changed,found=found,conflict=conflict }) : mode=="--stats"
                ? json.Serialize(new { endpoints=endpoints,scanned=scanned,eligible=result.Count,failedEndpoints=failedEndpoints,failedSessions=failedSessions })
                : json.Serialize(result)); return 0;
        } catch {
            if(mode=="--restore") return 1;
            if(mode=="--change") Console.WriteLine("{\"ok\":false,\"error\":\"chat_mix_inventory_unavailable\"}");
            else Console.Error.WriteLine("chat_mix_inventory_unavailable");
            return 1;
        }
        finally { Release(collection); Release(devices); }
    }
}
