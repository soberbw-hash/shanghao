#[cfg(windows)]
mod activation;
#[cfg(windows)]
mod capture;
#[cfg(windows)]
mod control;
mod protocol;
#[cfg(windows)]
mod sources;

pub fn dispatch(args: Vec<String>) -> Option<i32> {
    let mode = args.first()?.as_str();
    if !mode.starts_with("--application-audio-") {
        return None;
    }
    #[cfg(windows)]
    {
        if windows_version::OsVersion::current().build < 20_348 {
            protocol::status("error", Some("unsupported_os"));
            return Some(1);
        }
        if mode == "--application-audio-sources" && args.len() == 1 {
            match sources::list() {
                Ok(rows) => {
                    println!("{}", serde_json::json!({"sources": rows}));
                    return Some(0);
                }
                Err(_) => {
                    protocol::status("error", Some("source_enumeration_failed"));
                    return Some(1);
                }
            }
        }
        if mode == "--application-audio-capture" && args.len() == 3 {
            let parsed = args[1].parse::<u32>().ok().zip(args[2].parse::<u64>().ok());
            if let Some((pid, creation)) =
                parsed.filter(|(pid, creation)| *pid > 4 && *creation > 0)
            {
                return Some(match capture::run(pid, creation) {
                    Ok(reason) => {
                        protocol::status("stopped", Some(reason));
                        0
                    }
                    Err(reason) => {
                        protocol::status("error", Some(reason));
                        1
                    }
                });
            }
        }
    }
    protocol::status(
        "error",
        Some(if cfg!(windows) {
            "invalid_capture_request"
        } else {
            "unsupported_os"
        }),
    );
    Some(1)
}
