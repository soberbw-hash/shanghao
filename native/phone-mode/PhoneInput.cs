// Read-only input companion. Only the binding and modifier states are retained, never text.
using System;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

sealed class PhoneKeyState {
    readonly int key;
    readonly System.Collections.Generic.Dictionary<int,bool> states = new System.Collections.Generic.Dictionary<int,bool>();
    readonly System.Collections.Generic.Dictionary<int,long> mismatches = new System.Collections.Generic.Dictionary<int,long>();
    readonly Func<long> clock;
    public PhoneKeyState(int virtualKey, Func<long> now=null) { key=virtualKey; clock=now ?? (() => Environment.TickCount & Int32.MaxValue); }
    public void Keyboard(int virtualKey, int scan, int flags) {
        int side=virtualKey;
        if(virtualKey==0x10) side=scan==0x36 ? 0xA1 : 0xA0;
        if(virtualKey==0x11) side=(flags&2)!=0 ? 0xA3 : 0xA2;
        if(virtualKey==0x12) side=(flags&2)!=0 ? 0xA5 : 0xA4;
        if(virtualKey==key || (side>=0xA0 && side<=0xA5) || side==0x5B || side==0x5C) {
            states[side]=(flags&1)==0; mismatches.Remove(side);
        }
    }
    public void Mouse(int flags) {
        int press=key==5 ? 0x40 : key==6 ? 0x100 : 0;
        if(press==0) return;
        if((flags&press)!=0) { states[key]=true; mismatches.Remove(key); }
        if((flags&(press<<1))!=0) { states[key]=false; mismatches.Remove(key); }
    }
    public bool Read(int virtualKey, bool sampled, bool sampleReliable=false) {
        bool value;
        if(!states.TryGetValue(virtualKey,out value)) return sampled;
        // A missed raw break must not pin a hold forever. Only reconcile polling on
        // an accessible desktop at equal privilege; denied polling is not key-up.
        if(value==sampled || !sampleReliable) { mismatches.Remove(virtualKey); return value; }
        long now=clock(), since;
        if(!mismatches.TryGetValue(virtualKey,out since) || now<since) { mismatches[virtualKey]=now; return value; }
        if(now-since<40) return value;
        mismatches.Remove(virtualKey); states[virtualKey]=sampled;
        return sampled;
    }
}

// Message-only Raw Input is independent of low-level hooks and foreground focus.
// Discard other keys; never record text or suppress input in the foreground application.
sealed class PhoneRawInput : NativeWindow, IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Device { public ushort page, usage; public uint flags; public IntPtr target; }
    [StructLayout(LayoutKind.Sequential)] struct Header { public uint type, size; public IntPtr device, parameter; }
    [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterRawInputDevices(Device[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
    readonly PhoneKeyState state;
    readonly bool mouse;
    public bool Registered { get; private set; }
    public PhoneRawInput(int virtualKey) {
        state=new PhoneKeyState(virtualKey);
        mouse=virtualKey<=6;
        CreateHandle(new CreateParams { Parent=new IntPtr(-3) });
        var device=new Device { page=1, usage=6, flags=0x100, target=Handle };
        var devices=mouse ? new [] {device,new Device {page=1,usage=2,flags=0x100,target=Handle}} : new [] {device};
        Registered=RegisterRawInputDevices(devices,(uint)devices.Length,(uint)Marshal.SizeOf(typeof(Device)));
    }
    public void Pump() { Application.DoEvents(); }
    public bool Read(int key, bool sampled, bool reliable=false) { return Registered ? state.Read(key,sampled,reliable) : sampled; }
    protected override void WndProc(ref Message message) {
        if(message.Msg==0xFF) {
            uint size=0, headerSize=(uint)Marshal.SizeOf(typeof(Header));
            if(GetRawInputData(message.LParam,0x10000003,IntPtr.Zero,ref size,headerSize)==0 && size>=headerSize+16 && size<=1024) {
                IntPtr data=Marshal.AllocHGlobal((int)size);
                try {
                    if(GetRawInputData(message.LParam,0x10000003,data,ref size,headerSize)==size) {
                        int offset=(int)headerSize;
                        if(Marshal.ReadInt32(data)==1)
                            state.Keyboard(Marshal.ReadInt16(data,offset+6)&0xFFFF,Marshal.ReadInt16(data,offset)&0xFFFF,Marshal.ReadInt16(data,offset+2)&0xFFFF);
                        else if(mouse && Marshal.ReadInt32(data)==0 && size>=headerSize+24)
                            state.Mouse(Marshal.ReadInt16(data,offset+4)&0xFFFF);
                    }
                } finally { Marshal.FreeHGlobal(data); }
            }
        }
        base.WndProc(ref message);
    }
    public void Dispose() {
        if(Registered) {
            var keyboard=new Device {page=1,usage=6,flags=1,target=IntPtr.Zero};
            var devices=mouse ? new [] {keyboard,new Device {page=1,usage=2,flags=1,target=IntPtr.Zero}} : new [] {keyboard};
            RegisterRawInputDevices(devices,(uint)devices.Length,(uint)Marshal.SizeOf(typeof(Device)));
        }
        Registered=false;
        if(Handle!=IntPtr.Zero) DestroyHandle();
    }
}

class PhoneInput {
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    [DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
    [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window, out uint process);
    [DllImport("kernel32.dll")] static extern IntPtr OpenProcess(uint access, bool inherit, uint process);
    [DllImport("kernel32.dll")] static extern bool CloseHandle(IntPtr handle);
    [DllImport("advapi32.dll")] static extern bool OpenProcessToken(IntPtr process, uint access, out IntPtr token);
    [DllImport("advapi32.dll")] static extern bool GetTokenInformation(IntPtr token, int kind, out int value, int length, out int required);
    static bool? Elevated(uint process) {
        IntPtr handle=OpenProcess(0x1000,false,process), token=IntPtr.Zero;
        if(handle==IntPtr.Zero) return null;
        try {
            if(!OpenProcessToken(handle,8,out token)) return null;
            int value,required;
            return GetTokenInformation(token,20,out value,4,out required) ? (bool?)(value!=0) : null;
        } finally { if(token!=IntPtr.Zero) CloseHandle(token); CloseHandle(handle); }
    }
    static bool? ForegroundHigher(bool? elevated) {
        uint process; GetWindowThreadProcessId(GetForegroundWindow(),out process);
        bool? foreground=process==0 ? null : Elevated(process);
        return elevated.HasValue && foreground.HasValue ? (bool?)(!elevated.Value && foreground.Value) : null;
    }
    static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    static bool Modifier(PhoneRawInput raw, int left, int right, bool reliable) { return raw.Read(left,Down(left),reliable) || raw.Read(right,Down(right),reliable); }
    static volatile bool closing;
    [STAThread] static int Main() {
        try {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            var json = new JavaScriptSerializer();
            string config = Console.ReadLine();
            if(config == null || config.Length > 256) return 2;
            var values = json.Deserialize<System.Collections.Generic.Dictionary<string,int>>(config);
            int key;
            if(!values.TryGetValue("virtualKey", out key) || key < 1 || key > 255) return 2;
            new Thread(() => { while(Console.ReadLine()!=null) {} closing=true; }) { IsBackground=true }.Start();
            using(var raw=new PhoneRawInput(key)) {
            Console.WriteLine(json.Serialize(new { ready=true, rawInput=raw.Registered })); Console.Out.Flush();
            string previous = null;
            var heartbeat = System.Diagnostics.Stopwatch.StartNew();
            var diagnostics = System.Diagnostics.Stopwatch.StartNew();
            bool? elevated=Elevated((uint)System.Diagnostics.Process.GetCurrentProcess().Id);
            bool? higher=ForegroundHigher(elevated);
            bool blocked=false;
            while(!closing) {
                // Secure desktop / screen lock is not a user key release.
                IntPtr desktop=OpenInputDesktop(0,false,0x0101);
                if(desktop==IntPtr.Zero) {
                    if(!blocked || heartbeat.ElapsedMilliseconds>=1000) {
                        Console.WriteLine("{\"inputDesktopAvailable\":false}"); Console.Out.Flush(); heartbeat.Restart();
                    }
                    blocked=true; Thread.Sleep(50); continue;
                }
                CloseDesktop(desktop);
                if(diagnostics.ElapsedMilliseconds>=1000) {
                    higher=ForegroundHigher(elevated);
                    Console.WriteLine(json.Serialize(new { inputDesktopAvailable=true, foregroundHigher=higher }));
                    Console.Out.Flush(); diagnostics.Restart();
                }
                // Do not turn an inaccessible desktop into a synthetic key release.
                if(blocked) { previous=null; blocked=false; }
                raw.Pump();
                bool reliable=higher.HasValue && !higher.Value;
                bool down=raw.Read(key,Down(key),reliable);
                long sampledAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                string state=json.Serialize(new { down=down, ctrlKey=down && Modifier(raw,0xA2,0xA3,reliable),
                    shiftKey=down && Modifier(raw,0xA0,0xA1,reliable), altKey=down && Modifier(raw,0xA4,0xA5,reliable),
                    metaKey=down && Modifier(raw,0x5B,0x5C,reliable), inputDesktopAvailable=true });
                if(state!=previous || heartbeat.ElapsedMilliseconds>=1000) {
                    Console.WriteLine(state.Substring(0,state.Length-1)+",\"sampledAt\":"+sampledAt+"}");
                    Console.Out.Flush(); previous=state; heartbeat.Restart();
                }
                Thread.Sleep(8);
            }
            }
            return 0;
        } catch(Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
