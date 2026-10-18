// Read-only input companion. It observes only the configured key, never audio or text.
using System;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;
using System.Windows.Forms;

// Message-only Raw Input is independent of low-level hooks and foreground focus.
// Discard every key except the configured binding; never record text or suppress input.
sealed class PhoneRawInput : NativeWindow, IDisposable {
    [StructLayout(LayoutKind.Sequential)] struct Device { public ushort page, usage; public uint flags; public IntPtr target; }
    [StructLayout(LayoutKind.Sequential)] struct Header { public uint type, size; public IntPtr device, parameter; }
    [DllImport("user32.dll", SetLastError=true)] static extern bool RegisterRawInputDevices(Device[] devices, uint count, uint size);
    [DllImport("user32.dll")] static extern uint GetRawInputData(IntPtr input, uint command, IntPtr data, ref uint size, uint headerSize);
    readonly int key;
    bool? down;
    public bool Registered { get; private set; }
    public PhoneRawInput(int virtualKey) {
        key=virtualKey;
        if(key<=6) return; // Mouse buttons keep the physical sampling path.
        CreateHandle(new CreateParams { Parent=new IntPtr(-3) });
        var device=new Device { page=1, usage=6, flags=0x100, target=Handle };
        Registered=RegisterRawInputDevices(new [] {device},1,(uint)Marshal.SizeOf(typeof(Device)));
    }
    public bool Read(bool sampled) { Application.DoEvents(); return Registered && down.HasValue ? down.Value : sampled; }
    protected override void WndProc(ref Message message) {
        if(message.Msg==0xFF) {
            uint size=0, headerSize=(uint)Marshal.SizeOf(typeof(Header));
            if(GetRawInputData(message.LParam,0x10000003,IntPtr.Zero,ref size,headerSize)==0 && size>=headerSize+16 && size<=1024) {
                IntPtr data=Marshal.AllocHGlobal((int)size);
                try {
                    if(GetRawInputData(message.LParam,0x10000003,data,ref size,headerSize)==size && Marshal.ReadInt32(data)==1) {
                        int offset=(int)headerSize;
                        int virtualKey=Marshal.ReadInt16(data,offset+6)&0xFFFF;
                        if(virtualKey==key) down=(Marshal.ReadInt16(data,offset+2)&1)==0;
                    }
                } finally { Marshal.FreeHGlobal(data); }
            }
        }
        base.WndProc(ref message);
    }
    public void Dispose() {
        if(Registered) RegisterRawInputDevices(new [] {new Device {page=1,usage=6,flags=1,target=IntPtr.Zero}},1,(uint)Marshal.SizeOf(typeof(Device)));
        Registered=false;
        if(Handle!=IntPtr.Zero) DestroyHandle();
    }
}

class PhoneInput {
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
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
            while(!closing) {
                // Secure desktop / screen lock is not a user key release.
                IntPtr desktop=OpenInputDesktop(0,false,0x0101);
                if(desktop==IntPtr.Zero) { Thread.Sleep(50); continue; }
                CloseDesktop(desktop);
                bool down=raw.Read(Down(key));
                long sampledAt=DateTimeOffset.UtcNow.ToUnixTimeMilliseconds();
                string state=json.Serialize(new { down=down, ctrlKey=down && Down(0x11),
                    shiftKey=down && Down(0x10), altKey=down && Down(0x12),
                    metaKey=down && (Down(0x5B) || Down(0x5C)) });
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
