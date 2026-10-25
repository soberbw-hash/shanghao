//! Exclusive input worker. It never shares the blocking AI/process supervisor loop.
mod engine;
mod local_input;
mod platform;
mod protocol;

use engine::{Engine, Injector};
use platform::Platform;
use protocol::{Ack, Atom, Command, Held, INPUT_AGE_MS, MAX_LINE, MAX_QUEUE};
use serde_json::{Value, json};
use std::collections::VecDeque;
use std::io::{self, BufRead, Write};
use std::sync::{
    Arc, Mutex,
    atomic::{AtomicBool, AtomicU64, Ordering},
    mpsc,
};
use std::thread;
use std::time::{Duration, Instant};

struct Queued {
    command: Command,
    received: Instant,
}
#[derive(Default)]
struct Inbox {
    normal: VecDeque<Queued>,
    priority: VecDeque<Queued>,
}

/// Called before the ordinary Core stdin dispatcher. Live mode must be explicit.
pub fn dispatch_worker(arguments: &[String]) -> Option<i32> {
    if !arguments.iter().any(|arg| arg == "--remote-input-worker") {
        return None;
    }
    let mut parent = None;
    let mut dry = None;
    let mut index = 1;
    while index < arguments.len() {
        match arguments[index].as_str() {
            "--remote-input-worker" => {}
            "--parent-pid" if index + 1 < arguments.len() => {
                index += 1;
                parent = arguments[index].parse::<u32>().ok();
            }
            "--dry-run" if dry.is_none() => dry = Some(true),
            "--live" if dry.is_none() => dry = Some(false),
            _ => return Some(2),
        }
        index += 1;
    }
    Some(match (parent, dry) {
        (Some(parent), Some(dry)) => run(parent, dry),
        _ => 2,
    })
}

fn bounded_line(reader: &mut impl BufRead) -> io::Result<Option<Vec<u8>>> {
    let mut line = Vec::new();
    loop {
        let buffer = reader.fill_buf()?;
        if buffer.is_empty() {
            return if line.is_empty() {
                Ok(None)
            } else {
                Err(io::Error::other("unterminated_frame"))
            };
        }
        let count = buffer
            .iter()
            .position(|byte| *byte == b'\n')
            .map(|at| at + 1)
            .unwrap_or(buffer.len());
        if line.len() + count > MAX_LINE {
            return Err(io::Error::other("frame_too_large"));
        }
        line.extend_from_slice(&buffer[..count]);
        reader.consume(count);
        if line.last() == Some(&b'\n') {
            return Ok(Some(line));
        }
    }
}
fn ack(command: &Command, result: Result<(), &'static str>, applied: bool, dry: bool) -> Value {
    serde_json::to_value(Ack {
        request_id: command.id(),
        ok: result.is_ok(),
        applied: applied && result.is_ok() && !dry,
        dry_run: dry,
        error_code: result.err(),
    })
    .unwrap()
}
struct Guarded<'a> {
    platform: &'a mut Platform,
    floor: &'a AtomicU64,
    eof: &'a AtomicBool,
    generation: u64,
    deadline: Instant,
}
impl Injector for Guarded<'_> {
    fn send(&mut self, atom: Atom) -> bool {
        let releasing = atom.held().is_some_and(|(_, up)| up);
        if !releasing
            && (self.floor.load(Ordering::SeqCst) >= self.generation
                || self.eof.load(Ordering::SeqCst)
                || Instant::now() >= self.deadline
                || !self.platform.parent_alive()
                || !self.platform.desktop_safe()
                || self.platform.emergency())
        {
            return false;
        }
        self.platform.send(atom)
    }
    fn locally_held(&self, held: Held) -> bool {
        self.platform.locally_held(held)
    }
    fn local_takeover(&self, held: Held) -> bool {
        self.platform.local_takeover(held)
    }
}

fn run(parent_pid: u32, dry: bool) -> i32 {
    let mut platform = match Platform::new(parent_pid, dry) {
        Ok(platform) => platform,
        Err(code) => {
            println!("{}", json!({"kind":"fault","reason":code}));
            return 3;
        }
    };
    let inbox = Arc::new(Mutex::new(Inbox::default()));
    let floor = Arc::new(AtomicU64::new(0));
    let eof = Arc::new(AtomicBool::new(false));
    let (output, responses) = mpsc::sync_channel::<Value>(64);
    let writer_eof = eof.clone();
    thread::spawn(move || {
        let stdout = io::stdout();
        let mut writer = stdout.lock();
        for response in responses {
            if serde_json::to_writer(&mut writer, &response).is_err()
                || writer.write_all(b"\n").is_err()
                || writer.flush().is_err()
            {
                writer_eof.store(true, Ordering::SeqCst);
                break;
            }
        }
    });
    let _ = output.try_send(
        json!({"kind":"ready","protocolVersion":1,"supported":cfg!(windows) && !dry,
        "emergencyStopReady":platform.hotkey_ready(),"dryRun":dry}),
    );
    let (reader_inbox, reader_floor, reader_eof, reader_output) =
        (inbox.clone(), floor.clone(), eof.clone(), output.clone());
    thread::spawn(move || {
        let stdin = io::stdin();
        let mut reader = stdin.lock();
        while let Ok(Some(line)) = bounded_line(&mut reader) {
            let command = match serde_json::from_slice::<Command>(&line) {
                Ok(command) if command.valid_ids() => command,
                _ => {
                    let _ =
                        reader_output.try_send(json!({"kind":"fault","reason":"invalid_protocol"}));
                    break;
                }
            };
            let priority = matches!(command, Command::Revoke { .. } | Command::Shutdown { .. });
            if let Command::Revoke { generation, .. } = &command {
                reader_floor.fetch_max(*generation, Ordering::SeqCst);
            }
            let mut inbox = reader_inbox.lock().unwrap();
            let queue = if priority {
                &mut inbox.priority
            } else {
                &mut inbox.normal
            };
            if queue.len() >= if priority { 4 } else { MAX_QUEUE } {
                let _ = reader_output.try_send(ack(&command, Err("input_queue_full"), false, dry));
                if priority {
                    break;
                }
            } else {
                queue.push_back(Queued {
                    command,
                    received: Instant::now(),
                });
            }
        }
        reader_eof.store(true, Ordering::SeqCst);
    });
    let started = Instant::now();
    let mut engine = Engine::default();
    let mut terminating: Option<Instant> = None;
    loop {
        let now = started.elapsed().as_millis() as u64;
        platform.set_control_active(engine.active());
        let emergency = platform.emergency();
        let safe = platform.parent_alive()
            && platform.desktop_safe()
            && !emergency
            && !eof.load(Ordering::SeqCst);
        let was_active = engine.active();
        let parent_revoked = engine
            .generation()
            .is_some_and(|generation| generation <= floor.load(Ordering::SeqCst));
        engine.invalidate(floor.load(Ordering::SeqCst), &mut platform);
        engine.tick(now, safe, &mut platform);
        if was_active && !engine.active() && !parent_revoked {
            let reason = if emergency {
                platform.stop_reason()
            } else if !safe {
                "input_environment_unavailable"
            } else {
                "lease_expired"
            };
            let _ = output.try_send(
                json!({"kind":"revoked","reason":reason,"cleanupComplete":engine.clean()}),
            );
        }
        if eof.load(Ordering::SeqCst) || !platform.parent_alive() || terminating.is_some() {
            let deadline = terminating.get_or_insert_with(Instant::now);
            engine.stop(&mut platform);
            if engine.clean() {
                return 0;
            }
            if deadline.elapsed() >= Duration::from_millis(500) {
                return 4;
            }
        }
        let queued = {
            let mut inbox = inbox.lock().unwrap();
            inbox
                .priority
                .pop_front()
                .or_else(|| inbox.normal.pop_front())
        };
        if let Some(queued) = queued {
            let command = queued.command;
            let mut applied = false;
            let result = match &command {
                Command::Shutdown { .. } => {
                    engine.stop(&mut platform);
                    terminating = Some(Instant::now());
                    if engine.clean() {
                        Ok(())
                    } else {
                        Err("cleanup_pending")
                    }
                }
                Command::Revoke { generation, .. } => {
                    engine.invalidate(*generation, &mut platform);
                    if engine.clean() {
                        Ok(())
                    } else {
                        Err("cleanup_pending")
                    }
                }
                _ if !safe || terminating.is_some() => Err("input_environment_unavailable"),
                Command::Begin {
                    grant_id,
                    generation,
                    ..
                } => engine.begin(grant_id, *generation, now),
                Command::Heartbeat {
                    grant_id,
                    generation,
                    ..
                } => engine.heartbeat(grant_id, *generation, now),
                Command::Input {
                    grant_id,
                    generation,
                    event,
                    ..
                } => {
                    if queued.received.elapsed() > Duration::from_millis(INPUT_AGE_MS) {
                        engine.stop(&mut platform);
                        Err("stale_input")
                    } else {
                        let mut guarded = Guarded {
                            platform: &mut platform,
                            floor: &floor,
                            eof: &eof,
                            generation: *generation,
                            deadline: Instant::now() + Duration::from_millis(150),
                        };
                        let result = engine.input(grant_id, *generation, event, now, &mut guarded);
                        applied = result.is_ok();
                        result
                    }
                }
            };
            platform.set_control_active(engine.active());
            if output
                .try_send(ack(&command, result, applied, dry))
                .is_err()
            {
                eof.store(true, Ordering::SeqCst);
            }
        } else {
            thread::sleep(Duration::from_millis(5));
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn bounded_reader_never_allocates_arbitrary_line_sizes() {
        assert!(bounded_line(&mut io::Cursor::new(vec![b'x'; MAX_LINE + 1])).is_err());
        assert!(bounded_line(&mut io::Cursor::new(b"unterminated")).is_err());
        assert_eq!(
            bounded_line(&mut io::Cursor::new(b"{}\n")).unwrap(),
            Some(b"{}\n".to_vec())
        );
    }
    #[test]
    fn command_parser_is_fixed_and_accepts_native_point_shape() {
        let packet = r#"{"command":"input","requestId":"request-1","grantId":"grant-1","generation":1,"event":{"kind":"pointer","xPhysical":0,"yPhysical":0,"xDip":0,"yDip":0,"absoluteX":0,"absoluteY":65535}}"#;
        let command: Command = serde_json::from_str(packet).unwrap();
        assert!(command.valid_ids());
        assert!(
            serde_json::from_str::<Command>(
                r#"{"command":"shell","requestId":"1","program":"cmd"}"#
            )
            .is_err()
        );
    }
    #[test]
    fn live_mode_requires_an_explicit_dispatch_flag() {
        assert_eq!(dispatch_worker(&["core".into()]), None);
        assert_eq!(
            dispatch_worker(&[
                "core".into(),
                "--remote-input-worker".into(),
                "--parent-pid".into(),
                "1".into()
            ]),
            Some(2)
        );
    }
}
