// Windows inbox .NET Framework helper. No audio samples or volume levels are changed.
using System;
using System.IO;
using System.Linq;
using System.Collections.Generic;
using System.Collections.Concurrent;
using System.Runtime.InteropServices;
using System.Threading;
using System.Web.Script.Serialization;

[ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] class EnumeratorClass {}
[ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevices {
    void EnumAudioEndpoints(int flow, uint state, out IDeviceCollection devices);
    void GetDefaultAudioEndpoint(int flow, int role, out IDevice device);
    void GetDevice([MarshalAs(UnmanagedType.LPWStr)] string id, out IDevice device);
    void RegisterEndpointNotificationCallback(INotifications callback);
    void UnregisterEndpointNotificationCallback(INotifications callback);
}
[ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDeviceCollection {
    void GetCount(out uint count);
    void Item(uint index, out IDevice device);
}
[ComImport, Guid("1BE09788-6894-4089-8586-9A2A6C265AC5"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IEndpoint { void GetDataFlow(out int flow); }
[ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IDevice {
    void Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
    // Preserve the IMMDevice vtable slot; phone mode does not read properties.
    void OpenPropertyStore(uint mode, out IntPtr properties);
    void GetId([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[StructLayout(LayoutKind.Sequential)] public struct PropertyKey { public Guid format; public uint id; }
[ComImport, Guid("5CDF2C82-841E-4546-9722-0CF74078229A"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IVolume {
    void RegisterControlChangeNotify(IntPtr callback); void UnregisterControlChangeNotify(IntPtr callback);
    void GetChannelCount(out uint count);
    void SetMasterVolumeLevel(float value, ref Guid context); void SetMasterVolumeLevelScalar(float value, ref Guid context);
    void GetMasterVolumeLevel(out float value); void GetMasterVolumeLevelScalar(out float value);
    void SetChannelVolumeLevel(uint channel,float value,ref Guid context); void SetChannelVolumeLevelScalar(uint channel,float value,ref Guid context);
    void GetChannelVolumeLevel(uint channel,out float value); void GetChannelVolumeLevelScalar(uint channel,out float value);
    void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute, ref Guid context);
    void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[Guid("7991EEC9-7E89-4D85-8390-6C703CEC60C0"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface INotifications {
    [PreserveSig] int OnDeviceStateChanged([MarshalAs(UnmanagedType.LPWStr)] string id,uint state);
    [PreserveSig] int OnDeviceAdded([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnDeviceRemoved([MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnDefaultDeviceChanged(int flow,int role,[MarshalAs(UnmanagedType.LPWStr)] string id);
    [PreserveSig] int OnPropertyValueChanged([MarshalAs(UnmanagedType.LPWStr)] string id,PropertyKey key);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public class Notifications : INotifications {
    readonly Action changed;
    public Notifications(Action action) { changed = action; }
    public int OnDeviceStateChanged(string id,uint state) { changed(); return 0; }
    public int OnDeviceAdded(string id) { changed(); return 0; }
    public int OnDeviceRemoved(string id) { return 0; }
    public int OnDefaultDeviceChanged(int flow,int role,string id) { changed(); return 0; }
    public int OnPropertyValueChanged(string id,PropertyKey key) { return 0; }
}
class Command { public long id { get; set; } public bool active { get; set; } public bool inspect { get; set; } public string inputDeviceId { get; set; } public string outputDeviceId { get; set; } }
class Saved { public string id { get; set; } public bool muted { get; set; } }
class PhoneAudio {
    readonly IDevices devices = (IDevices)new EnumeratorClass();
    readonly JavaScriptSerializer json = new JavaScriptSerializer();
    readonly Dictionary<string,Saved> saved = new Dictionary<string,Saved>();
    readonly string journal;
    readonly Mutex ownership = new Mutex(false, @"Local\ShangHao.PhoneAudio." + System.Security.Principal.WindowsIdentity.GetCurrent().User.Value);
    bool ownsAudio;
    bool active;
    readonly bool keepMuted;
    static Guid context = new Guid("CF533E15-463A-41B1-A64A-B70B7763A7AB");
    PhoneAudio(string path, bool preserveMute) {
        journal = path;
        keepMuted = preserveMute;
        if (File.Exists(journal)) foreach (Saved item in json.Deserialize<Saved[]>(File.ReadAllText(journal))) saved[item.id] = item;
    }
    void Acquire() {
        if(ownsAudio) return;
        try { ownsAudio=ownership.WaitOne(0); }
        catch(AbandonedMutexException) { ownsAudio=true; }
        if(!ownsAudio) throw new Exception("另一个上号窗口正在使用电话模式");
    }
    void Persist() {
        string pending = journal + ".pending";
        using (var file = new FileStream(pending,FileMode.Create,FileAccess.Write,FileShare.None)) {
            byte[] bytes = System.Text.Encoding.UTF8.GetBytes(json.Serialize(saved.Values.ToArray()));
            file.Write(bytes,0,bytes.Length); file.Flush(true);
        }
        if (File.Exists(journal)) File.Replace(pending,journal,null); else File.Move(pending,journal);
    }
    static IVolume Volume(IDevice device) {
        Guid iid = typeof(IVolume).GUID; object value;
        device.Activate(ref iid,23,IntPtr.Zero,out value); return (IVolume)value;
    }
    List<string> Targets() {
        var ids = new HashSet<string>();
        IDeviceCollection collection=null;
        try {
            // eAll + DEVICE_STATE_ACTIVE: every active render AND capture endpoint.
            // Browser device hashes are not Windows endpoint IDs and are not used here.
            devices.EnumAudioEndpoints(2,1,out collection);
            uint count; collection.GetCount(out count);
            for(uint index=0;index<count;index++) {
                IDevice device=null;
                try { collection.Item(index,out device); string id; device.GetId(out id); ids.Add(id); }
                finally { if(device!=null) Marshal.ReleaseComObject(device); }
            }
        } finally { if(collection!=null) Marshal.ReleaseComObject(collection); }
        if(ids.Count==0) throw new Exception("没有可用的音频设备");
        return ids.ToList();
    }
    void Mute() {
        Acquire();
        int failed=0;
        foreach(string id in Targets()) {
            IDevice device=null; IVolume volume=null;
            try {
                devices.GetDevice(id,out device);
                volume=Volume(device);
                if(!saved.ContainsKey(id)) { bool muted; volume.GetMute(out muted); saved[id]=new Saved { id=id,muted=muted }; Persist(); }
                volume.SetMute(true,ref context);
                bool verified; volume.GetMute(out verified);
                if(!verified) throw new Exception("静音回读失败");
            } catch { failed++; }
            finally { if(volume!=null) Marshal.ReleaseComObject(volume); if(device!=null) Marshal.ReleaseComObject(device); }
        }
        if(failed>0) throw new Exception("有 " + failed + " 个设备未能确认静音，请使用硬件静音；已静音设备保持静音");
    }
    string Restore() {
        active=false;
        if(saved.Count>0) Acquire();
        foreach(Saved item in saved.Values.ToArray()) {
            IDevice device=null; IVolume volume=null;
            try { devices.GetDevice(item.id,out device); volume=Volume(device); volume.SetMute(item.muted,ref context); bool verified; volume.GetMute(out verified); if(verified==item.muted) saved.Remove(item.id); }
            catch(COMException) { /* Unplugged endpoints remain in the recovery journal. */ }
            finally { if(volume!=null) Marshal.ReleaseComObject(volume); if(device!=null) Marshal.ReleaseComObject(device); }
        }
        Persist();
        if(ownsAudio) { ownership.ReleaseMutex(); ownsAudio=false; }
        return saved.Count==0 ? null : "部分设备暂时无法恢复，重新接入后将继续恢复";
    }
    void Reply(long id,string error,bool ready=false) { Console.WriteLine(json.Serialize(new { id=id, active=active, error=error, ready=ready })); Console.Out.Flush(); }
    void Inspect(long requestId) {
        var endpoints=new List<object>();
        foreach(string id in Targets()) {
            IDevice device; devices.GetDevice(id,out device); IVolume volume=null;
            try { volume=Volume(device); bool muted; float level; int flow; ((IEndpoint)device).GetDataFlow(out flow); volume.GetMute(out muted); volume.GetMasterVolumeLevelScalar(out level); endpoints.Add(new { id=id,flow=flow,muted=muted,level=level }); }
            finally { if(volume!=null) Marshal.ReleaseComObject(volume); Marshal.ReleaseComObject(device); }
        }
        Console.WriteLine(json.Serialize(new { id=requestId,endpoints=endpoints })); Console.Out.Flush();
    }
    void Run() {
        var queue = new BlockingCollection<string>();
        int deviceEventQueued=0;
        var callback = new Notifications(() => { if(Interlocked.Exchange(ref deviceEventQueued,1)==0) queue.Add("devices"); });
        devices.RegisterEndpointNotificationCallback(callback);
        new Thread(() => { try { string line; while((line=Console.ReadLine())!=null && line.Length<16384) queue.Add(line); } finally { queue.Add("exit"); } }) { IsBackground=true }.Start();
        try {
            string initialError=null;
            if(keepMuted) { active=true; try { Mute(); } catch(Exception cause) { initialError=cause.Message; } }
            else initialError=Restore();
            Reply(0,initialError,true);
            foreach(string line in queue.GetConsumingEnumerable()) {
                if(line=="exit") break;
                long id=0; string error=null;
                try {
                    if(line=="devices") { Interlocked.Exchange(ref deviceEventQueued,0); if(active) Mute(); else if(saved.Count>0) error=Restore(); else continue; }
                    else {
                        var command=json.Deserialize<Command>(line); id=command.id;
                        if(command.inspect) { Inspect(id); continue; }
                        if(command.active) {
                            if(!active && saved.Count>0) { error=Restore(); if(error!=null) throw new Exception(error); }
                            active=true; Mute();
                        } else error=Restore();
                    }
                } catch(Exception cause) { error=cause.Message; /* Fail closed: never unmute successful endpoints on activation failure. */ }
                Reply(id,error);
            }
        } finally {
            // Unexpected parent loss must not expose a private call. A normal
            // exit sends active=false first; the next launch can recover the journal.
            if(!active) Restore();
            devices.UnregisterEndpointNotificationCallback(callback); Marshal.ReleaseComObject(devices);
        }
    }
    [MTAThread] static int Main(string[] args) {
        try {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            if(args.Length<1 || args.Length>2) return 2;
            string path=Path.GetFullPath(args[0]); Directory.CreateDirectory(Path.GetDirectoryName(path));
            // The lock covers live sessions and stale-session recovery alike.
            using(var file=new FileStream(path+".lock",FileMode.OpenOrCreate,FileAccess.ReadWrite,FileShare.None)) { new PhoneAudio(path,args.Length==2 && args[1]=="--keep-muted").Run(); }
            return 0;
        } catch(Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
