use super::engine::Injector;
use super::local_input::{INJECTED_MARKER, LocalInputMonitor};
use super::protocol::{Atom, Held};

pub struct Platform {
    local_input: Option<LocalInputMonitor>,
    dry_run: bool,
    #[cfg(windows)]
    parent: windows_sys::Win32::Foundation::HANDLE,
    #[cfg(windows)]
    hotkey: bool,
    emergency: bool,
}
impl Platform {
    pub fn new(parent_pid: u32, dry_run: bool) -> Result<Self, &'static str> {
        if parent_pid == 0 {
            return Err("invalid_parent");
        }
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::{
                System::Threading::OpenProcess, UI::Input::KeyboardAndMouse::*,
            };
            let parent = OpenProcess(0x0010_0000, 0, parent_pid);
            if parent.is_null() {
                return Err("parent_unavailable");
            }
            let hotkey = !dry_run
                && RegisterHotKey(
                    std::ptr::null_mut(),
                    0x5348,
                    MOD_CONTROL | MOD_ALT | MOD_NOREPEAT,
                    VK_ESCAPE as u32,
                ) != 0;
            if !dry_run && !hotkey {
                windows_sys::Win32::Foundation::CloseHandle(parent);
                return Err("emergency_hotkey_unavailable");
            }
            let local_input = if dry_run {
                None
            } else {
                match LocalInputMonitor::install() {
                    Ok(monitor) => Some(monitor),
                    Err(error) => {
                        UnregisterHotKey(std::ptr::null_mut(), 0x5348);
                        windows_sys::Win32::Foundation::CloseHandle(parent);
                        return Err(error);
                    }
                }
            };
            return Ok(Self {
                local_input,
                dry_run,
                parent,
                hotkey,
                emergency: false,
            });
        }
        #[cfg(not(windows))]
        {
            if !dry_run {
                return Err("platform_read_only");
            }
            Ok(Self {
                local_input: None,
                dry_run,
                emergency: false,
            })
        }
    }
    pub fn set_control_active(&self, active: bool) {
        if let Some(monitor) = &self.local_input {
            monitor.arm(active);
        }
    }
    pub fn stop_reason(&self) -> &'static str {
        "local-input-or-emergency-hotkey"
    }
    pub fn parent_alive(&self) -> bool {
        #[cfg(windows)]
        unsafe {
            return windows_sys::Win32::System::Threading::WaitForSingleObject(self.parent, 0)
                == windows_sys::Win32::Foundation::WAIT_TIMEOUT;
        }
        #[cfg(not(windows))]
        {
            true
        }
    }
    pub fn emergency(&mut self) -> bool {
        #[cfg(windows)]
        if !self.dry_run {
            unsafe {
                use windows_sys::Win32::UI::WindowsAndMessaging::*;
                let mut message = std::mem::zeroed();
                while PeekMessageW(&mut message, std::ptr::null_mut(), 0, 0, PM_REMOVE) != 0 {
                    if message.message == WM_HOTKEY && message.wParam == 0x5348 {
                        self.emergency = true;
                    }
                    TranslateMessage(&message);
                    DispatchMessageW(&message);
                }
            }
        }
        if self
            .local_input
            .as_ref()
            .is_some_and(|monitor| monitor.take_local_input())
        {
            self.emergency = true;
        }
        self.emergency
    }
    pub fn desktop_safe(&self) -> bool {
        if self.dry_run {
            return true;
        }
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::System::StationsAndDesktops::*;
            let desktop = OpenInputDesktop(0, 0, DESKTOP_READOBJECTS);
            if desktop.is_null() {
                return false;
            }
            let mut name = [0_u16; 64];
            let mut needed = 0;
            let ok = GetUserObjectInformationW(
                desktop,
                UOI_NAME,
                name.as_mut_ptr().cast(),
                std::mem::size_of_val(&name) as u32,
                &mut needed,
            ) != 0;
            CloseDesktop(desktop);
            let count = name
                .iter()
                .position(|unit| *unit == 0)
                .unwrap_or(name.len());
            return ok && String::from_utf16_lossy(&name[..count]).eq_ignore_ascii_case("Default");
        }
        #[cfg(not(windows))]
        {
            false
        }
    }
    pub fn hotkey_ready(&self) -> bool {
        #[cfg(windows)]
        {
            self.hotkey
        }
        #[cfg(not(windows))]
        {
            false
        }
    }
}
impl Injector for Platform {
    fn send(&mut self, atom: Atom) -> bool {
        // Dry-run never reaches any SendInput call. Tests only construct this mode.
        if self.dry_run {
            return true;
        }
        if let Some((held, true)) = atom.held() {
            self.emergency(); // Pump pending physical hook messages before cleanup.
            if self.local_takeover(held) {
                return true;
            }
        }
        #[cfg(windows)]
        unsafe {
            use super::protocol::Button;
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
            let input = match atom {
                Atom::Key(scan, extended, up) => INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: 0,
                            wScan: scan,
                            dwFlags: KEYEVENTF_SCANCODE
                                | if extended { KEYEVENTF_EXTENDEDKEY } else { 0 }
                                | if up { KEYEVENTF_KEYUP } else { 0 },
                            time: 0,
                            dwExtraInfo: INJECTED_MARKER,
                        },
                    },
                },
                Atom::Unicode(unit, up) => INPUT {
                    r#type: INPUT_KEYBOARD,
                    Anonymous: INPUT_0 {
                        ki: KEYBDINPUT {
                            wVk: 0,
                            wScan: unit,
                            dwFlags: KEYEVENTF_UNICODE | if up { KEYEVENTF_KEYUP } else { 0 },
                            time: 0,
                            dwExtraInfo: INJECTED_MARKER,
                        },
                    },
                },
                mouse => {
                    let (dx, dy, data, flags) = match mouse {
                        Atom::Move(x, y) => (
                            x as i32,
                            y as i32,
                            0,
                            MOUSEEVENTF_MOVE | MOUSEEVENTF_ABSOLUTE | MOUSEEVENTF_VIRTUALDESK,
                        ),
                        Atom::Wheel(horizontal, delta) => (
                            0,
                            0,
                            delta as u32,
                            if horizontal {
                                MOUSEEVENTF_HWHEEL
                            } else {
                                MOUSEEVENTF_WHEEL
                            },
                        ),
                        Atom::Button(button, up) => (
                            0,
                            0,
                            0,
                            match (button, up) {
                                (Button::Left, false) => MOUSEEVENTF_LEFTDOWN,
                                (Button::Left, true) => MOUSEEVENTF_LEFTUP,
                                (Button::Right, false) => MOUSEEVENTF_RIGHTDOWN,
                                (Button::Right, true) => MOUSEEVENTF_RIGHTUP,
                                (Button::Middle, false) => MOUSEEVENTF_MIDDLEDOWN,
                                (Button::Middle, true) => MOUSEEVENTF_MIDDLEUP,
                            },
                        ),
                        _ => unreachable!(),
                    };
                    INPUT {
                        r#type: INPUT_MOUSE,
                        Anonymous: INPUT_0 {
                            mi: MOUSEINPUT {
                                dx,
                                dy,
                                mouseData: data,
                                dwFlags: flags,
                                time: 0,
                                dwExtraInfo: INJECTED_MARKER,
                            },
                        },
                    }
                }
            };
            // Each call has one atom. Partial batch success cannot hide a held key.
            return SendInput(1, &input, std::mem::size_of::<INPUT>() as i32) == 1;
        }
        #[cfg(not(windows))]
        {
            let _ = atom;
            false
        }
    }
    fn local_takeover(&self, held: Held) -> bool {
        self.local_input
            .as_ref()
            .is_some_and(|monitor| monitor.physically_held(held))
    }
    fn locally_held(&self, held: Held) -> bool {
        if self.dry_run {
            return false;
        }
        #[cfg(windows)]
        unsafe {
            use super::protocol::Button;
            use windows_sys::Win32::UI::Input::KeyboardAndMouse::*;
            let virtual_key = match held {
                Held::Key(scan, extended) => MapVirtualKeyW(
                    scan as u32 | if extended { 0xe000 } else { 0 },
                    MAPVK_VSC_TO_VK_EX,
                ),
                Held::Button(button) => match button {
                    Button::Left => VK_LBUTTON as u32,
                    Button::Right => VK_RBUTTON as u32,
                    Button::Middle => VK_MBUTTON as u32,
                },
                Held::Unicode(_) => return false,
            };
            return virtual_key != 0 && GetAsyncKeyState(virtual_key as i32) < 0;
        }
        #[cfg(not(windows))]
        {
            let _ = held;
            false
        }
    }
}
impl Drop for Platform {
    fn drop(&mut self) {
        #[cfg(windows)]
        unsafe {
            if self.hotkey {
                windows_sys::Win32::UI::Input::KeyboardAndMouse::UnregisterHotKey(
                    std::ptr::null_mut(),
                    0x5348,
                );
            }
            windows_sys::Win32::Foundation::CloseHandle(self.parent);
        }
    }
}
