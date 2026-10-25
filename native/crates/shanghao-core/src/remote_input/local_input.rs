//! Non-blocking local-priority hooks. Physical input always passes through.
use super::protocol::{Button, Held};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};

pub const INJECTED_MARKER: usize = 0x5348_5243;
static ARMED: AtomicBool = AtomicBool::new(false);
static LOCAL_INPUT: AtomicBool = AtomicBool::new(false);
static PHYSICAL: PhysicalHeld = PhysicalHeld::new();

struct PhysicalHeld {
    words: [AtomicU64; 9],
}
impl PhysicalHeld {
    const fn new() -> Self {
        Self {
            words: [const { AtomicU64::new(0) }; 9],
        }
    }
    fn bit(held: Held) -> Option<(usize, u64)> {
        let index = match held {
            Held::Key(scan, extended) if scan < 256 => {
                scan as usize + if extended { 256 } else { 0 }
            }
            Held::Button(Button::Left) => 512,
            Held::Button(Button::Middle) => 513,
            Held::Button(Button::Right) => 514,
            _ => return None,
        };
        Some((index / 64, 1 << (index % 64)))
    }
    fn observe(&self, held: Held, up: bool, marker: usize) {
        if marker == INJECTED_MARKER {
            return;
        }
        if let Some((word, bit)) = Self::bit(held) {
            if up {
                self.words[word].fetch_and(!bit, Ordering::SeqCst);
            } else {
                self.words[word].fetch_or(bit, Ordering::SeqCst);
            }
        }
    }
    fn held(&self, held: Held) -> bool {
        Self::bit(held)
            .is_some_and(|(word, bit)| self.words[word].load(Ordering::SeqCst) & bit != 0)
    }
    fn suppress_own_release(&self, held: Held, up: bool, marker: usize) -> bool {
        marker == INJECTED_MARKER && up && self.held(held)
    }
    fn clear(&self) {
        for word in &self.words {
            word.store(0, Ordering::SeqCst);
        }
    }
}

fn should_stop(armed: bool, extra_info: usize) -> bool {
    armed && extra_info != INJECTED_MARKER
}

pub struct LocalInputMonitor {
    #[cfg(windows)]
    keyboard: windows_sys::Win32::UI::WindowsAndMessaging::HHOOK,
    #[cfg(windows)]
    mouse: windows_sys::Win32::UI::WindowsAndMessaging::HHOOK,
}
impl LocalInputMonitor {
    pub fn install() -> Result<Self, &'static str> {
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::{
                System::LibraryLoader::GetModuleHandleW, UI::WindowsAndMessaging::*,
            };
            let module = GetModuleHandleW(std::ptr::null());
            if module.is_null() {
                return Err("local_input_module_unavailable");
            }
            let keyboard = SetWindowsHookExW(WH_KEYBOARD_LL, Some(keyboard_hook), module, 0);
            if keyboard.is_null() {
                return Err("local_keyboard_hook_unavailable");
            }
            let mouse = SetWindowsHookExW(WH_MOUSE_LL, Some(mouse_hook), module, 0);
            if mouse.is_null() {
                UnhookWindowsHookEx(keyboard);
                return Err("local_mouse_hook_unavailable");
            }
            ARMED.store(false, Ordering::SeqCst);
            LOCAL_INPUT.store(false, Ordering::SeqCst);
            PHYSICAL.clear();
            return Ok(Self { keyboard, mouse });
        }
        #[cfg(not(windows))]
        {
            Err("platform_read_only")
        }
    }
    pub fn arm(&self, active: bool) {
        ARMED.store(active, Ordering::SeqCst);
    }
    pub fn take_local_input(&self) -> bool {
        LOCAL_INPUT.swap(false, Ordering::SeqCst)
    }
    pub fn physically_held(&self, held: Held) -> bool {
        PHYSICAL.held(held)
    }
}
#[cfg(windows)]
unsafe extern "system" fn keyboard_hook(code: i32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    if code >= 0 && lparam != 0 {
        let event = unsafe { &*(lparam as *const KBDLLHOOKSTRUCT) };
        let held = Held::Key(event.scanCode as u16, event.flags & LLKHF_EXTENDED != 0);
        let up = event.flags & LLKHF_UP != 0;
        // Only suppress our own synthetic release after the user took ownership.
        // Physical input always continues through CallNextHookEx.
        if PHYSICAL.suppress_own_release(held, up, event.dwExtraInfo) {
            return 1;
        }
        PHYSICAL.observe(held, up, event.dwExtraInfo);
        if should_stop(ARMED.load(Ordering::SeqCst), event.dwExtraInfo) {
            LOCAL_INPUT.store(true, Ordering::SeqCst);
        }
    }
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}
#[cfg(windows)]
unsafe extern "system" fn mouse_hook(code: i32, wparam: usize, lparam: isize) -> isize {
    use windows_sys::Win32::UI::WindowsAndMessaging::*;
    if code >= 0 && lparam != 0 {
        let event = unsafe { &*(lparam as *const MSLLHOOKSTRUCT) };
        let button = match wparam as u32 {
            WM_LBUTTONDOWN => Some((Button::Left, false)),
            WM_LBUTTONUP => Some((Button::Left, true)),
            WM_MBUTTONDOWN => Some((Button::Middle, false)),
            WM_MBUTTONUP => Some((Button::Middle, true)),
            WM_RBUTTONDOWN => Some((Button::Right, false)),
            WM_RBUTTONUP => Some((Button::Right, true)),
            _ => None,
        };
        if let Some((button, up)) = button {
            let held = Held::Button(button);
            if PHYSICAL.suppress_own_release(held, up, event.dwExtraInfo) {
                return 1;
            }
            PHYSICAL.observe(held, up, event.dwExtraInfo);
        }
        if should_stop(ARMED.load(Ordering::SeqCst), event.dwExtraInfo) {
            LOCAL_INPUT.store(true, Ordering::SeqCst);
        }
    }
    unsafe { CallNextHookEx(std::ptr::null_mut(), code, wparam, lparam) }
}
impl Drop for LocalInputMonitor {
    fn drop(&mut self) {
        ARMED.store(false, Ordering::SeqCst);
        #[cfg(windows)]
        unsafe {
            use windows_sys::Win32::UI::WindowsAndMessaging::UnhookWindowsHookEx;
            UnhookWindowsHookEx(self.keyboard);
            UnhookWindowsHookEx(self.mouse);
        }
    }
}
#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn physical_or_foreign_input_only_reclaims_while_armed() {
        assert!(!should_stop(false, 0));
        assert!(should_stop(true, 0));
        assert!(should_stop(true, 123));
        assert!(!should_stop(true, INJECTED_MARKER));
    }
    #[test]
    fn later_local_down_is_preserved_through_own_cleanup_until_real_local_up() {
        let physical = PhysicalHeld::new();
        for held in [
            Held::Key(0x1d, false),
            Held::Key(0x1d, true),
            Held::Button(Button::Left),
            Held::Button(Button::Middle),
            Held::Button(Button::Right),
        ] {
            physical.observe(held, false, INJECTED_MARKER);
            assert!(!physical.held(held));
            physical.observe(held, false, 0);
            assert!(physical.held(held));
            assert!(physical.suppress_own_release(held, true, INJECTED_MARKER));
            assert!(!physical.suppress_own_release(held, true, 0));
            physical.observe(held, true, INJECTED_MARKER);
            assert!(physical.held(held));
            physical.observe(held, true, 0);
            assert!(!physical.held(held));
            assert!(!physical.suppress_own_release(held, true, INJECTED_MARKER));
        }
    }
}
