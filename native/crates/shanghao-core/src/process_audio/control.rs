use super::sources::ProcessHandle;
use std::{
    io::Read,
    sync::{
        Arc, Mutex,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::{Duration, Instant},
};

#[derive(Debug, PartialEq)]
enum Command {
    Ping,
    Run,
    Stop,
}
fn command(line: &[u8]) -> Command {
    match line {
        b"ping" => Command::Ping,
        b"run" => Command::Run,
        _ => Command::Stop,
    }
}

pub struct Control {
    pub stopped: Arc<AtomicBool>,
    pub running: Arc<AtomicBool>,
    heartbeat: Arc<Mutex<Instant>>,
}
impl Control {
    pub fn start() -> Self {
        let stopped = Arc::new(AtomicBool::new(false));
        let running = Arc::new(AtomicBool::new(false));
        let heartbeat = Arc::new(Mutex::new(Instant::now()));
        let stop = stopped.clone();
        let run = running.clone();
        let beat = heartbeat.clone();
        thread::spawn(move || {
            let mut input = std::io::stdin().lock();
            let mut line = Vec::new();
            let mut byte = [0_u8; 1];
            while input.read_exact(&mut byte).is_ok() {
                if byte[0] == b'\n' {
                    match command(&line) {
                        Command::Ping => {
                            if let Ok(mut beat) = beat.lock() {
                                *beat = Instant::now();
                            }
                        }
                        Command::Run => {
                            run.store(true, Ordering::Release);
                        }
                        Command::Stop => break,
                    }
                    line.clear();
                } else if line.len() < 32 {
                    line.push(byte[0]);
                } else {
                    break;
                }
            }
            stop.store(true, Ordering::Release);
        });
        Self {
            stopped,
            running,
            heartbeat,
        }
    }
    pub fn reason(&self, target: &ProcessHandle) -> Option<&'static str> {
        if target.exited() {
            Some("source_exited")
        } else if self.stopped.load(Ordering::Acquire) {
            Some("capture_stopped")
        } else if self
            .heartbeat
            .lock()
            .map_or(true, |beat| beat.elapsed() > Duration::from_secs(8))
        {
            Some("parent_watchdog_expired")
        } else {
            None
        }
    }
}

#[cfg(test)]
mod tests {
    #[test]
    fn only_exact_parent_commands_can_extend_or_start_capture() {
        use super::{Command, command};
        assert_eq!(command(b"ping"), Command::Ping);
        assert_eq!(command(b"run"), Command::Run);
        assert_eq!(command(b"stop"), Command::Stop);
        assert_eq!(command(b"ping trailing"), Command::Stop);
        assert_eq!(command(b"run-other-process"), Command::Stop);
    }
}
