use std::io::{self, BufRead};
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use serde_json::{Value, json};

#[derive(Debug, Deserialize)]
#[serde(tag = "command", rename_all = "snake_case")]
enum CoreCommand {
    Capabilities {
        request_id: Option<String>,
    },
    ActivitySnapshot {
        request_id: Option<String>,
    },
    ActivityProcessSnapshot {
        request_id: Option<String>,
    },
    ActivityProcessDetails {
        request_id: Option<String>,
        process_ids: Vec<u32>,
    },
    FileIdentity {
        request_id: Option<String>,
        path: String,
    },
    SuperviseProcess {
        request_id: Option<String>,
        program: String,
        #[serde(default)]
        args: Vec<String>,
        #[serde(default = "default_timeout_ms")]
        timeout_ms: u64,
    },
}

impl CoreCommand {
    fn request_id(&self) -> Option<&str> {
        match self {
            Self::Capabilities { request_id }
            | Self::ActivitySnapshot { request_id }
            | Self::ActivityProcessSnapshot { request_id }
            | Self::ActivityProcessDetails { request_id, .. }
            | Self::FileIdentity { request_id, .. }
            | Self::SuperviseProcess { request_id, .. } => request_id.as_deref(),
        }
    }
}

#[derive(Debug, Serialize)]
struct CoreResponse {
    request_id: Option<String>,
    ok: bool,
    result: Option<Value>,
    error: Option<CoreResponseError>,
}

#[derive(Debug, Serialize)]
struct CoreResponseError {
    code: &'static str,
    message: String,
}

fn default_timeout_ms() -> u64 {
    30_000
}

fn ok(command: &CoreCommand, result: Value) -> CoreResponse {
    CoreResponse {
        request_id: command.request_id().map(str::to_owned),
        ok: true,
        result: Some(result),
        error: None,
    }
}

fn error(
    command: Option<&CoreCommand>,
    code: &'static str,
    message: impl Into<String>,
) -> CoreResponse {
    CoreResponse {
        request_id: command.and_then(CoreCommand::request_id).map(str::to_owned),
        ok: false,
        result: None,
        error: Some(CoreResponseError {
            code,
            message: message.into(),
        }),
    }
}

fn capabilities() -> Value {
    json!({
        "protocolVersion": 1,
        "platform": std::env::consts::OS,
        "commands": ["capabilities", "activity_snapshot", "activity_process_snapshot", "activity_process_details", "file_identity", "supervise_process"],
        "nativeActivity": cfg!(windows),
        "stableFileIdentity": cfg!(windows),
        "processSupervision": true
    })
}

fn supervise_process(program: &str, args: &[String], timeout_ms: u64) -> io::Result<Value> {
    let mut child = Command::new(program)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()?;
    let started = Instant::now();
    let bounded_timeout = Duration::from_millis(timeout_ms.clamp(100, 24 * 60 * 60 * 1_000));

    loop {
        if let Some(status) = child.try_wait()? {
            return Ok(json!({
                "pid": child.id(),
                "timedOut": false,
                "exitCode": status.code()
            }));
        }
        if started.elapsed() >= bounded_timeout {
            child.kill()?;
            let status = child.wait()?;
            return Ok(json!({
                "pid": child.id(),
                "timedOut": true,
                "exitCode": status.code()
            }));
        }
        thread::sleep(Duration::from_millis(25));
    }
}

#[cfg(windows)]
fn activity_snapshot() -> io::Result<Value> {
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW, GetWindowThreadProcessId,
    };

    unsafe {
        let window = GetForegroundWindow();
        if window.is_null() {
            return Ok(json!({ "available": false }));
        }
        let mut pid = 0_u32;
        GetWindowThreadProcessId(window, &mut pid);
        let title_length = GetWindowTextLengthW(window).max(0) as usize;
        let mut title = vec![0_u16; title_length + 1];
        let copied = GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32).max(0) as usize;
        title.truncate(copied);

        let executable_path = query_executable_path(pid);

        Ok(json!({
            "available": true,
            "pid": pid,
            "windowTitle": String::from_utf16_lossy(&title),
            "executablePath": executable_path
        }))
    }
}

#[cfg(windows)]
fn activity_process_snapshot() -> io::Result<Value> {
    use std::collections::HashMap;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE, LPARAM};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, PROCESSENTRY32W, Process32FirstW, Process32NextW,
        TH32CS_SNAPPROCESS,
    };
    use windows_sys::Win32::UI::WindowsAndMessaging::{
        EnumWindows, GetForegroundWindow, GetWindowTextLengthW, GetWindowTextW,
        GetWindowThreadProcessId, IsWindowVisible,
    };

    unsafe extern "system" fn collect_window_title(
        window: *mut std::ffi::c_void,
        data: LPARAM,
    ) -> i32 {
        unsafe {
            if IsWindowVisible(window) == 0 {
                return 1;
            }
            let title_length = GetWindowTextLengthW(window);
            if title_length <= 0 {
                return 1;
            }
            let mut pid = 0_u32;
            GetWindowThreadProcessId(window, &mut pid);
            let titles = &mut *(data as *mut HashMap<u32, String>);
            if titles.contains_key(&pid) {
                return 1;
            }
            let mut title = vec![0_u16; (title_length as usize).min(1_024) + 1];
            let copied = GetWindowTextW(window, title.as_mut_ptr(), title.len() as i32);
            if copied > 0 {
                titles.insert(pid, String::from_utf16_lossy(&title[..copied as usize]));
            }
            1
        }
    }

    let mut titles = HashMap::<u32, String>::new();
    let mut foreground_pid = 0_u32;
    unsafe {
        GetWindowThreadProcessId(GetForegroundWindow(), &mut foreground_pid);
        EnumWindows(Some(collect_window_title), &mut titles as *mut _ as LPARAM);

        let handle = CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0);
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }

        let mut entry: PROCESSENTRY32W = std::mem::zeroed();
        entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;
        let mut processes = Vec::new();
        if Process32FirstW(handle, &mut entry) != 0 {
            loop {
                let name_end = entry
                    .szExeFile
                    .iter()
                    .position(|unit| *unit == 0)
                    .unwrap_or(entry.szExeFile.len());
                let process_name = String::from_utf16_lossy(&entry.szExeFile[..name_end]);
                let pid = entry.th32ProcessID;
                processes.push(json!({
                    "ProcessId": pid,
                    "ProcessName": process_name,
                    "MainWindowTitle": titles.remove(&pid).unwrap_or_default(),
                    "ParentProcessId": entry.th32ParentProcessID,
                    "IsForeground": pid == foreground_pid,
                }));
                if processes.len() >= 4_096 || Process32NextW(handle, &mut entry) == 0 {
                    break;
                }
            }
        }
        CloseHandle(handle);
        Ok(json!({ "available": true, "processes": processes }))
    }
}

#[cfg(windows)]
fn query_executable_path(pid: u32) -> Option<String> {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, QueryFullProcessImageNameW,
    };

    unsafe {
        let process = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, 0, pid);
        if process.is_null() {
            return None;
        }
        let mut buffer = vec![0_u16; 32_768];
        let mut length = buffer.len() as u32;
        let succeeded = QueryFullProcessImageNameW(process, 0, buffer.as_mut_ptr(), &mut length);
        CloseHandle(process);
        (succeeded != 0).then(|| String::from_utf16_lossy(&buffer[..length as usize]))
    }
}

#[cfg(windows)]
fn activity_process_details(process_ids: &[u32]) -> io::Result<Value> {
    use std::collections::HashSet;

    let mut seen = HashSet::new();
    let processes: Vec<Value> = process_ids
        .iter()
        .copied()
        .filter(|pid| *pid != 0 && seen.insert(*pid))
        .take(64)
        .map(|pid| json!({ "ProcessId": pid, "Path": query_executable_path(pid) }))
        .collect();
    Ok(json!({ "processes": processes }))
}

#[cfg(not(windows))]
fn activity_process_details(_process_ids: &[u32]) -> io::Result<Value> {
    Ok(json!({ "processes": [] }))
}

#[cfg(not(windows))]
fn activity_process_snapshot() -> io::Result<Value> {
    Ok(json!({ "available": false, "processes": [] }))
}

#[cfg(not(windows))]
fn activity_snapshot() -> io::Result<Value> {
    Ok(json!({ "available": false }))
}

#[cfg(windows)]
fn file_identity(path: &Path) -> io::Result<Value> {
    use std::os::windows::ffi::OsStrExt;
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::Storage::FileSystem::BY_HANDLE_FILE_INFORMATION;
    use windows_sys::Win32::Storage::FileSystem::{
        CreateFileW, FILE_FLAG_BACKUP_SEMANTICS, FILE_SHARE_DELETE, FILE_SHARE_READ,
        FILE_SHARE_WRITE, GetFileInformationByHandle, OPEN_EXISTING,
    };

    let wide: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    unsafe {
        let handle = CreateFileW(
            wide.as_ptr(),
            0,
            FILE_SHARE_READ | FILE_SHARE_WRITE | FILE_SHARE_DELETE,
            std::ptr::null(),
            OPEN_EXISTING,
            FILE_FLAG_BACKUP_SEMANTICS,
            std::ptr::null_mut(),
        );
        if handle == INVALID_HANDLE_VALUE {
            return Err(io::Error::last_os_error());
        }
        let mut info: BY_HANDLE_FILE_INFORMATION = std::mem::zeroed();
        let succeeded = GetFileInformationByHandle(handle, &mut info);
        CloseHandle(handle);
        if succeeded == 0 {
            return Err(io::Error::last_os_error());
        }
        let file_index = ((info.nFileIndexHigh as u64) << 32) | info.nFileIndexLow as u64;
        Ok(json!({
            "volumeSerialNumber": info.dwVolumeSerialNumber,
            "fileIndex": file_index,
            "stableId": format!("{:08x}:{:016x}", info.dwVolumeSerialNumber, file_index)
        }))
    }
}

#[cfg(not(windows))]
fn file_identity(path: &Path) -> io::Result<Value> {
    let canonical = path.canonicalize()?;
    Ok(json!({ "stableId": canonical.to_string_lossy(), "native": false }))
}

fn handle(command: &CoreCommand) -> CoreResponse {
    let result = match command {
        CoreCommand::Capabilities { .. } => Ok(capabilities()),
        CoreCommand::ActivitySnapshot { .. } => activity_snapshot(),
        CoreCommand::ActivityProcessSnapshot { .. } => activity_process_snapshot(),
        CoreCommand::ActivityProcessDetails { process_ids, .. } => {
            activity_process_details(process_ids)
        }
        CoreCommand::FileIdentity { path, .. } => file_identity(Path::new(path)),
        CoreCommand::SuperviseProcess {
            program,
            args,
            timeout_ms,
            ..
        } => supervise_process(program, args, *timeout_ms),
    };
    match result {
        Ok(value) => ok(command, value),
        Err(cause) => error(Some(command), "native_operation_failed", cause.to_string()),
    }
}

fn main() {
    for line in io::stdin().lock().lines() {
        let response = match line {
            Ok(line) if line.len() <= 1024 * 1024 => {
                match serde_json::from_str::<CoreCommand>(&line) {
                    Ok(command) => handle(&command),
                    Err(cause) => error(None, "invalid_command", cause.to_string()),
                }
            }
            Ok(_) => error(None, "command_too_large", "command exceeds 1 MiB"),
            Err(cause) => error(None, "read_failed", cause.to_string()),
        };
        println!(
            "{}",
            serde_json::to_string(&response).expect("serialize response")
        );
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capabilities_are_versioned_and_bounded() {
        let value = capabilities();
        assert_eq!(value["protocolVersion"], 1);
        assert_eq!(value["commands"].as_array().map(Vec::len), Some(6));
    }

    #[test]
    fn invalid_program_returns_a_typed_failure() {
        let command = CoreCommand::SuperviseProcess {
            request_id: Some("test".into()),
            program: "this-program-does-not-exist-shanghao".into(),
            args: Vec::new(),
            timeout_ms: 100,
        };
        let response = handle(&command);
        assert!(!response.ok);
        assert_eq!(response.request_id.as_deref(), Some("test"));
    }
}
