using System;

// Test native state handling without hooks, synthetic OS input, or audio-device access.
class PhoneKeyStateTests {
    static int assertions;
    static void Equal(bool actual, bool expected, string message) {
        assertions++;
        if(actual!=expected) throw new Exception(message);
    }
    public static int Main() {
        var state=new PhoneKeyState(40);
        Equal(state.Read(40,true),true,"unknown primary uses physical sample");
        state.Keyboard(40,0x50,2);
        Equal(state.Read(40,false),true,"raw arrow survives a denied async-key-state read");
        state.Keyboard(40,0x50,3);
        Equal(state.Read(40,true),false,"raw release wins over stale polling");
        state.Keyboard(0x11,0x1D,0);
        state.Keyboard(0x11,0x1D,2);
        state.Keyboard(0x11,0x1D,1);
        Equal(state.Read(0xA2,true),false,"left control released");
        Equal(state.Read(0xA3,false),true,"right control remains held");
        state.Keyboard(0x11,0x1D,3);
        Equal(state.Read(0xA3,true),false,"right control released");
        state.Keyboard(0x10,0x36,0);
        Equal(state.Read(0xA1,false),true,"right shift uses scan code");
        state.Keyboard(0x12,0x38,2);
        Equal(state.Read(0xA5,false),true,"right alt uses extended flag");
        state.Keyboard(0x5B,0,0);
        Equal(state.Read(0x5B,false),true,"windows modifier retained");
        state.Keyboard(65,0,0);
        Equal(state.Read(65,false),false,"unrelated letters are discarded");
        long now=0;
        var repair=new PhoneKeyState(113,()=>now);
        repair.Keyboard(113,0,0);
        Equal(repair.Read(113,false,true),true,"transient polling mismatch cannot release immediately");
        now=41;
        Equal(repair.Read(113,false,true),false,"missed key-up reconciles within 40ms on accessible desktop");
        repair.Keyboard(113,0,0);
        Equal(repair.Read(113,false,false),true,"higher privilege polling cannot fabricate release");
        now=60000;
        Equal(repair.Read(113,false,false),true,"denied polling never times out a held key");
        repair.Keyboard(113,0,1);
        Equal(repair.Read(113,true,true),false,"raw release wins over a momentary stale poll");
        for(int key=5;key<=6;key++) {
            var mouse=new PhoneKeyState(key);
            int press=key==5 ? 0x40 : 0x100;
            mouse.Mouse(press);
            Equal(mouse.Read(key,false),true,"raw mouse side-button press");
            mouse.Mouse(1);
            Equal(mouse.Read(key,false),true,"other mouse button cannot release binding");
            mouse.Mouse(press<<1);
            Equal(mouse.Read(key,true),false,"raw mouse side-button release");
        }
        Console.WriteLine("{\"passed\":"+assertions+",\"systemInputInjected\":false,\"audioDevicesModified\":false}");
        return 0;
    }
}
