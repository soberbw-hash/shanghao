use serde::{Deserialize, Serialize};

pub const MAX_LINE: usize = 8192;
pub const MAX_QUEUE: usize = 16;
pub const LEASE_MS: u64 = 1000;
pub const INPUT_AGE_MS: u64 = 200;

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "command",
    rename_all = "snake_case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Command {
    Begin {
        request_id: String,
        grant_id: String,
        generation: u64,
    },
    Input {
        request_id: String,
        grant_id: String,
        generation: u64,
        event: Event,
    },
    Heartbeat {
        request_id: String,
        grant_id: String,
        generation: u64,
    },
    Revoke {
        request_id: String,
        grant_id: String,
        generation: u64,
    },
    Shutdown {
        request_id: String,
    },
}
impl Command {
    pub fn id(&self) -> &str {
        match self {
            Self::Begin { request_id, .. }
            | Self::Input { request_id, .. }
            | Self::Heartbeat { request_id, .. }
            | Self::Revoke { request_id, .. }
            | Self::Shutdown { request_id } => request_id,
        }
    }
    pub fn valid_ids(&self) -> bool {
        let valid = |s: &str| {
            !s.is_empty()
                && s.len() <= 80
                && s.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'-')
        };
        valid(self.id())
            && match self {
                Self::Begin {
                    grant_id,
                    generation,
                    ..
                }
                | Self::Input {
                    grant_id,
                    generation,
                    ..
                }
                | Self::Heartbeat {
                    grant_id,
                    generation,
                    ..
                }
                | Self::Revoke {
                    grant_id,
                    generation,
                    ..
                } => valid(grant_id) && *generation > 0 && *generation <= 9_007_199_254_740_991,
                Self::Shutdown { .. } => true,
            }
    }
}

#[derive(Clone, Debug, Deserialize)]
#[serde(
    tag = "kind",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase",
    deny_unknown_fields
)]
pub enum Event {
    Pointer {
        #[serde(flatten)]
        point: Point,
    },
    Button {
        button: Button,
        pressed: bool,
        #[serde(flatten)]
        point: Point,
    },
    Wheel {
        delta_x: f64,
        delta_y: f64,
        #[serde(flatten)]
        point: Point,
    },
    Key {
        code: String,
        pressed: bool,
        #[serde(default)]
        repeat: bool,
    },
    Text {
        text: String,
    },
}
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Point {
    pub x_physical: f64,
    pub y_physical: f64,
    pub x_dip: f64,
    pub y_dip: f64,
    pub absolute_x: i64,
    pub absolute_y: i64,
}
#[derive(Clone, Copy, Debug, Deserialize, PartialEq, Eq, PartialOrd, Ord)]
#[serde(rename_all = "lowercase")]
pub enum Button {
    Left,
    Right,
    Middle,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq, PartialOrd, Ord)]
pub enum Held {
    Key(u16, bool),
    Unicode(u16),
    Button(Button),
}
#[derive(Clone, Copy, Debug, PartialEq)]
pub enum Atom {
    Move(u16, u16),
    Key(u16, bool, bool),
    Unicode(u16, bool),
    Button(Button, bool),
    Wheel(bool, i32),
}
impl Atom {
    pub fn held(&self) -> Option<(Held, bool)> {
        match *self {
            Self::Key(scan, extended, up) => Some((Held::Key(scan, extended), up)),
            Self::Unicode(unit, up) => Some((Held::Unicode(unit), up)),
            Self::Button(button, up) => Some((Held::Button(button), up)),
            _ => None,
        }
    }
    pub fn release(held: Held) -> Self {
        match held {
            Held::Key(scan, extended) => Self::Key(scan, extended, true),
            Held::Unicode(unit) => Self::Unicode(unit, true),
            Held::Button(button) => Self::Button(button, true),
        }
    }
}

pub fn scan_code(code: &str) -> Option<(u16, bool)> {
    let plain = match code {
        "Backquote" => 0x29,
        "Minus" => 0x0c,
        "Equal" => 0x0d,
        "BracketLeft" => 0x1a,
        "BracketRight" => 0x1b,
        "Backslash" => 0x2b,
        "Semicolon" => 0x27,
        "Quote" => 0x28,
        "Comma" => 0x33,
        "Period" => 0x34,
        "Slash" => 0x35,
        "Space" => 0x39,
        "Tab" => 0x0f,
        "Enter" => 0x1c,
        "Backspace" => 0x0e,
        "Escape" => 0x01,
        "ShiftLeft" => 0x2a,
        "ShiftRight" => 0x36,
        "ControlLeft" => 0x1d,
        "AltLeft" => 0x38,
        "CapsLock" => 0x3a,
        "NumpadAdd" => 0x4e,
        "NumpadSubtract" => 0x4a,
        "NumpadMultiply" => 0x37,
        "NumpadDecimal" => 0x53,
        "NumLock" => 0x45,
        "ControlRight" => return Some((0x1d, true)),
        "AltRight" => return Some((0x38, true)),
        "NumpadEnter" => return Some((0x1c, true)),
        "NumpadDivide" => return Some((0x35, true)),
        "Insert" => return Some((0x52, true)),
        "Delete" => return Some((0x53, true)),
        "Home" => return Some((0x47, true)),
        "End" => return Some((0x4f, true)),
        "PageUp" => return Some((0x49, true)),
        "PageDown" => return Some((0x51, true)),
        "ArrowUp" => return Some((0x48, true)),
        "ArrowDown" => return Some((0x50, true)),
        "ArrowLeft" => return Some((0x4b, true)),
        "ArrowRight" => return Some((0x4d, true)),
        _ => {
            let bytes = code.as_bytes();
            if bytes.len() == 4 && code.starts_with("Key") && bytes[3].is_ascii_uppercase() {
                return Some((
                    [
                        0x1e, 0x30, 0x2e, 0x20, 0x12, 0x21, 0x22, 0x23, 0x17, 0x24, 0x25, 0x26,
                        0x32, 0x31, 0x18, 0x19, 0x10, 0x13, 0x1f, 0x14, 0x16, 0x2f, 0x11, 0x2d,
                        0x15, 0x2c,
                    ][(bytes[3] - b'A') as usize],
                    false,
                ));
            }
            if bytes.len() == 6 && code.starts_with("Digit") && bytes[5].is_ascii_digit() {
                return Some((
                    if bytes[5] == b'0' {
                        0x0b
                    } else {
                        1 + (bytes[5] - b'0') as u16
                    },
                    false,
                ));
            }
            if bytes.len() == 7 && code.starts_with("Numpad") && bytes[6].is_ascii_digit() {
                return Some((
                    [0x52, 0x4f, 0x50, 0x51, 0x4b, 0x4c, 0x4d, 0x47, 0x48, 0x49]
                        [(bytes[6] - b'0') as usize],
                    false,
                ));
            }
            let number = code.strip_prefix('F')?.parse::<u16>().ok()?;
            if format!("F{number}") != code {
                return None;
            }
            return match number {
                1..=10 => Some((0x3a + number, false)),
                11 => Some((0x57, false)),
                12 => Some((0x58, false)),
                _ => None,
            };
        }
    };
    Some((plain, false))
}

pub fn atoms(event: &Event) -> Result<Vec<Atom>, &'static str> {
    let move_to = |point: &Point| {
        if ![point.x_physical, point.y_physical, point.x_dip, point.y_dip]
            .iter()
            .all(|n| n.is_finite() && n.abs() <= 1_000_000.0)
            || !(0..=65535).contains(&point.absolute_x)
            || !(0..=65535).contains(&point.absolute_y)
        {
            return Err("invalid_point");
        }
        Ok(Atom::Move(point.absolute_x as u16, point.absolute_y as u16))
    };
    Ok(match event {
        Event::Pointer { point } => vec![move_to(point)?],
        Event::Button {
            button,
            pressed,
            point,
        } => vec![move_to(point)?, Atom::Button(*button, !pressed)],
        Event::Wheel {
            delta_x,
            delta_y,
            point,
        } => {
            if !delta_x.is_finite()
                || !delta_y.is_finite()
                || delta_x.abs() > 1200.0
                || delta_y.abs() > 1200.0
            {
                return Err("invalid_wheel");
            }
            vec![
                move_to(point)?,
                Atom::Wheel(true, delta_x.round() as i32),
                Atom::Wheel(false, delta_y.round() as i32),
            ]
        }
        Event::Key {
            code,
            pressed,
            repeat,
        } => {
            if *repeat && !pressed {
                return Err("invalid_repeat");
            }
            let (scan, extended) = scan_code(code).ok_or("unsupported_key")?;
            vec![Atom::Key(scan, extended, !pressed)]
        }
        Event::Text { text } => {
            if text.is_empty()
                || text.chars().count() > 128
                || text
                    .chars()
                    .any(|c| c.is_control() && c != '\n' && c != '\t')
            {
                return Err("invalid_text");
            }
            text.encode_utf16()
                .flat_map(|unit| [Atom::Unicode(unit, false), Atom::Unicode(unit, true)])
                .collect()
        }
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ack<'a> {
    pub request_id: &'a str,
    pub ok: bool,
    pub applied: bool,
    pub dry_run: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error_code: Option<&'a str>,
}
