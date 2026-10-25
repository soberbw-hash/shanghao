pub const CHANNELS: u16 = 2;
pub const SAMPLE_RATE: u32 = 48_000;
pub const MAX_FRAMES: usize = 960;

pub fn packet(samples: &[u8], sequence: u32) -> Vec<u8> {
    let frames = samples.len() / (CHANNELS as usize * 2);
    assert!(frames > 0 && frames <= MAX_FRAMES && samples.len() % 4 == 0);
    let mut bytes = Vec::with_capacity(24 + samples.len());
    bytes.extend_from_slice(b"SHAU");
    bytes.extend_from_slice(&1_u16.to_le_bytes());
    bytes.extend_from_slice(&CHANNELS.to_le_bytes());
    bytes.extend_from_slice(&SAMPLE_RATE.to_le_bytes());
    bytes.extend_from_slice(&(frames as u32).to_le_bytes());
    bytes.extend_from_slice(&sequence.to_le_bytes());
    bytes.extend_from_slice(&(samples.len() as u32).to_le_bytes());
    bytes.extend_from_slice(samples);
    bytes
}

pub fn status(kind: &str, code: Option<&str>) {
    eprintln!(
        "{}",
        serde_json::json!({"type":kind,"code":code,"sampleRate":SAMPLE_RATE,"channels":CHANNELS,"format":"s16le"})
    );
}

#[cfg(test)]
mod tests {
    #[test]
    fn pcm_header_is_fixed_and_little_endian() {
        let bytes = super::packet(&[123, 0, 0, 0, 0, 0, 0, 0], 7);
        assert_eq!(
            &bytes[..24],
            &[
                83, 72, 65, 85, 1, 0, 2, 0, 128, 187, 0, 0, 2, 0, 0, 0, 7, 0, 0, 0, 8, 0, 0, 0
            ]
        );
        assert_eq!(&bytes[24..], &[123, 0, 0, 0, 0, 0, 0, 0]);
    }
}
