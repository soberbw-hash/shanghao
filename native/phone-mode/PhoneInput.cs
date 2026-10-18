// Read-only input companion. It observes only the configured key, never audio or text.
using System;
using System.Threading;
using System.Runtime.InteropServices;
using System.Web.Script.Serialization;

class PhoneInput {
    [DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);
    [DllImport("user32.dll")] static extern IntPtr OpenInputDesktop(uint flags, bool inherit, uint access);
    [DllImport("user32.dll")] static extern bool CloseDesktop(IntPtr desktop);
    static bool Down(int key) { return (GetAsyncKeyState(key) & 0x8000) != 0; }
    static volatile bool closing;
    static int Main() {
        try {
            Console.OutputEncoding = new System.Text.UTF8Encoding(false);
            var json = new JavaScriptSerializer();
            string config = Console.ReadLine();
            if(config == null || config.Length > 256) return 2;
            var values = json.Deserialize<System.Collections.Generic.Dictionary<string,int>>(config);
            int key;
            if(!values.TryGetValue("virtualKey", out key) || key < 1 || key > 255) return 2;
            new Thread(() => { while(Console.ReadLine()!=null) {} closing=true; }) { IsBackground=true }.Start();
            Console.WriteLine("{\"ready\":true}"); Console.Out.Flush();
            string previous = null;
            var heartbeat = System.Diagnostics.Stopwatch.StartNew();
            while(!closing) {
                // Secure desktop / screen lock is not a user key release.
                IntPtr desktop=OpenInputDesktop(0,false,0x0101);
                if(desktop==IntPtr.Zero) { Thread.Sleep(50); continue; }
                CloseDesktop(desktop);
                bool down=Down(key);
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
            return 0;
        } catch(Exception error) { Console.Error.WriteLine(error.Message); return 1; }
    }
}
