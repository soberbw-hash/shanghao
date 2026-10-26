// Render session muting avoids blocking USB hardware volume/mute controls.
// All calls run on the PhoneAudio MTA worker; callbacks only enqueue reconciliation.
using System;
using System.Collections.Generic;
using System.Runtime.InteropServices;

[ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPhoneSessionManager {
    void GetAudioSessionControl(IntPtr session,uint flags,out IntPtr control);
    void GetSimpleAudioVolume(IntPtr session,uint flags,out IntPtr volume);
    void GetSessionEnumerator(out IPhoneSessionEnumerator enumerator);
    void RegisterSessionNotification(IPhoneSessionNotification callback);
    void UnregisterSessionNotification(IPhoneSessionNotification callback);
}
[ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPhoneSessionEnumerator {
    void GetCount(out int count);
    void GetSession(int index,out IPhoneSessionControl session);
}
[ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPhoneSessionControl {
    void GetState(out int state);
    void GetDisplayName([MarshalAs(UnmanagedType.LPWStr)] out string name);
    void SetDisplayName([MarshalAs(UnmanagedType.LPWStr)] string name,ref Guid context);
    void GetIconPath([MarshalAs(UnmanagedType.LPWStr)] out string path);
    void SetIconPath([MarshalAs(UnmanagedType.LPWStr)] string path,ref Guid context);
    void GetGroupingParam(out Guid group);
    void SetGroupingParam(ref Guid group,ref Guid context);
    void RegisterAudioSessionNotification(IntPtr callback);
    void UnregisterAudioSessionNotification(IntPtr callback);
    void GetSessionIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
    void GetSessionInstanceIdentifier([MarshalAs(UnmanagedType.LPWStr)] out string id);
}
[ComImport, Guid("87CE5498-68D6-44E5-9215-6DA47EF883D8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
interface IPhoneSessionVolume {
    void SetMasterVolume(float level,ref Guid context);
    void GetMasterVolume(out float level);
    void SetMute([MarshalAs(UnmanagedType.Bool)] bool mute,ref Guid context);
    void GetMute([MarshalAs(UnmanagedType.Bool)] out bool mute);
}
[ComVisible(true), Guid("641DD20B-4D41-49CC-ABA3-174B9477BB08"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IPhoneSessionNotification {
    [PreserveSig] int OnSessionCreated([MarshalAs(UnmanagedType.IUnknown)] object session);
}
[ComVisible(true), ClassInterface(ClassInterfaceType.None)]
public sealed class PhoneSessionNotification : IPhoneSessionNotification {
    readonly Action changed;
    public PhoneSessionNotification(Action callback) { changed=callback; }
    public int OnSessionCreated(object session) { changed(); return 0; }
}

sealed class PhoneRenderSessions : IDisposable {
    sealed class Watch { public IPhoneSessionManager manager; public PhoneSessionNotification callback; }
    readonly Dictionary<string,Watch> watches=new Dictionary<string,Watch>();
    readonly Action changed;
    static Guid context=new Guid("CF533E15-463A-41B1-A64A-B70B7763A7AB");
    public PhoneRenderSessions(Action callback) { changed=callback; }
    IPhoneSessionManager Manager(string id,IDevice device) {
        Watch watch;
        if(watches.TryGetValue(id,out watch)) return watch.manager;
        Guid iid=typeof(IPhoneSessionManager).GUID; object value;
        device.Activate(ref iid,23,IntPtr.Zero,out value);
        var manager=(IPhoneSessionManager)value;
        var callback=new PhoneSessionNotification(changed);
        try {
            // Register before enumeration: sessions created during the snapshot are queued.
            manager.RegisterSessionNotification(callback);
            watches[id]=new Watch {manager=manager,callback=callback};
            return manager;
        } catch { Marshal.ReleaseComObject(manager); throw; }
    }
    void Each(string id,IDevice device,Action<string,IPhoneSessionVolume> action) {
        IPhoneSessionEnumerator sessions=null;
        try {
            Manager(id,device).GetSessionEnumerator(out sessions);
            int count; sessions.GetCount(out count);
            for(int index=0;index<count;index++) {
                IPhoneSessionControl control=null;
                try {
                    sessions.GetSession(index,out control);
                    int state; control.GetState(out state);
                    if(state==2) continue; // Expired instance cannot play or be re-used.
                    string instance; control.GetSessionInstanceIdentifier(out instance);
                    action(instance,(IPhoneSessionVolume)control);
                } finally { if(control!=null) Marshal.ReleaseComObject(control); }
            }
        } finally { if(sessions!=null) Marshal.ReleaseComObject(sessions); }
    }
    public void Mute(string id,IDevice device,Dictionary<string,Saved> saved,Action persist) {
        Each(id,device,(instance,volume)=>{
            string key="session:"+instance;
            bool original; volume.GetMute(out original);
            if(!saved.ContainsKey(key)) {
                saved[key]=new Saved {id=key,device=id,muted=original,kind="session"};
                persist(); // Original mute is durable before changing any session.
            }
            volume.SetMute(true,ref context);
            bool actual; volume.GetMute(out actual);
            if(!actual) throw new Exception("应用声音静音未确认");
        });
    }
    public bool Restore(Saved saved,IDevice device) {
        bool found=false, restored=false;
        Each(saved.device,device,(instance,volume)=>{
            if("session:"+instance!=saved.id) return;
            found=true;
            volume.SetMute(saved.muted,ref context);
            bool actual; volume.GetMute(out actual);
            restored=actual==saved.muted;
        });
        // Only the exact original session may be restored. An exited application
        // has nothing left to unmute; never apply its saved state to a new instance.
        return !found || restored;
    }
    public bool AllMuted(string id,IDevice device) {
        bool result=true;
        Each(id,device,(_instance,volume)=>{bool muted;volume.GetMute(out muted);result &= muted;});
        return result;
    }
    public void Dispose() {
        foreach(var watch in watches.Values) {
            try { watch.manager.UnregisterSessionNotification(watch.callback); } catch(COMException) { }
            Marshal.ReleaseComObject(watch.manager);
        }
        watches.Clear();
    }
}
