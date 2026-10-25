use serde::Serialize;
use std::{collections::HashSet, io};
use windows_sys::Win32::{
    Foundation::{CloseHandle, FILETIME, HANDLE, LPARAM, WAIT_OBJECT_0},
    System::Threading::{
        GetProcessTimes, OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_SYNCHRONIZE,
        QueryFullProcessImageNameW, WaitForSingleObject,
    },
    UI::WindowsAndMessaging::{
        EnumWindows, GWL_EXSTYLE, GetWindowLongPtrW, GetWindowTextW, GetWindowThreadProcessId,
        IsWindowVisible, WS_EX_TOOLWINDOW,
    },
};

pub struct ProcessHandle(pub HANDLE);
impl Drop for ProcessHandle {
    fn drop(&mut self) {
        unsafe {
            CloseHandle(self.0);
        }
    }
}
impl ProcessHandle {
    pub fn open(pid: u32) -> io::Result<Self> {
        let handle = unsafe {
            OpenProcess(
                PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_SYNCHRONIZE,
                0,
                pid,
            )
        };
        if handle.is_null() {
            Err(io::Error::last_os_error())
        } else {
            Ok(Self(handle))
        }
    }
    pub fn creation(&self) -> io::Result<u64> {
        let mut times = [FILETIME {
            dwLowDateTime: 0,
            dwHighDateTime: 0,
        }; 4];
        let ptr = times.as_mut_ptr();
        if unsafe { GetProcessTimes(self.0, ptr, ptr.add(1), ptr.add(2), ptr.add(3)) } == 0 {
            return Err(io::Error::last_os_error());
        }
        Ok((u64::from(times[0].dwHighDateTime) << 32) | u64::from(times[0].dwLowDateTime))
    }
    pub fn exited(&self) -> bool {
        unsafe { WaitForSingleObject(self.0, 0) == WAIT_OBJECT_0 }
    }
    fn image_path(&self) -> Option<String> {
        let mut path = [0_u16; 32768];
        let mut size = path.len() as u32;
        if unsafe { QueryFullProcessImageNameW(self.0, 0, path.as_mut_ptr(), &mut size) } == 0 {
            return None;
        }
        Some(String::from_utf16_lossy(&path[..size as usize]))
    }
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Source {
    pub pid: u32,
    pub creation_time: String,
    pub process_name: String,
    pub name: String,
    pub executable_path: String,
}

pub fn list() -> io::Result<Vec<Source>> {
    struct Rows {
        rows: Vec<Source>,
        seen: HashSet<u32>,
    }
    unsafe extern "system" fn collect(window: HANDLE, data: LPARAM) -> i32 {
        let rows = unsafe { &mut *(data as *mut Rows) };
        if rows.rows.len() >= 256
            || unsafe { IsWindowVisible(window) } == 0
            || unsafe { GetWindowLongPtrW(window, GWL_EXSTYLE) } as u32 & WS_EX_TOOLWINDOW != 0
        {
            return 1;
        }
        let mut title = [0_u16; 257];
        let count = unsafe { GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32) };
        if count <= 0 {
            return 1;
        }
        let mut pid = 0;
        unsafe {
            GetWindowThreadProcessId(window, &mut pid);
        }
        if pid <= 4 || pid == std::process::id() || rows.seen.contains(&pid) {
            return 1;
        }
        if let Ok(handle) = ProcessHandle::open(pid) {
            if let (Ok(creation), Some(image_path)) = (handle.creation(), handle.image_path()) {
                if !handle.exited() {
                    rows.seen.insert(pid);
                    rows.rows.push(Source {
                        pid,
                        creation_time: creation.to_string(),
                        process_name: image_path
                            .rsplit('\\')
                            .next()
                            .unwrap_or_default()
                            .to_owned(),
                        name: String::from_utf16_lossy(&title[..count as usize]),
                        executable_path: image_path,
                    });
                }
            }
        }
        1
    }
    let mut rows = Rows {
        rows: Vec::new(),
        seen: HashSet::new(),
    };
    if unsafe { EnumWindows(Some(collect), &mut rows as *mut Rows as LPARAM) } == 0 {
        return Err(io::Error::last_os_error());
    }
    Ok(rows.rows)
}
