use super::{
    activation::{self, Apartment},
    control::Control,
    protocol,
    sources::ProcessHandle,
};
use std::{
    io::Write,
    sync::{
        atomic::Ordering,
        mpsc::{self, SyncSender},
    },
    thread,
    time::Duration,
};
use windows::Win32::Media::Audio::*;
use windows_sys::Win32::{
    Foundation::{WAIT_FAILED, WAIT_OBJECT_0},
    System::Threading::{CreateEventW, WaitForSingleObject},
};

pub fn run(pid: u32, creation_time: u64) -> Result<&'static str, &'static str> {
    let target = ProcessHandle::open(pid).map_err(|_| "source_unavailable")?;
    if target.creation().map_err(|_| "source_unavailable")? != creation_time {
        return Err("source_identity_changed");
    }
    let control = Control::start();
    let _apartment = Apartment::new()?;
    let Some(client) =
        activation::activate(&_apartment, pid, || control.reason(&target).is_some())?
    else {
        return Ok(control.reason(&target).unwrap_or("capture_stopped"));
    };
    let event = ProcessHandle(unsafe { CreateEventW(std::ptr::null(), 0, 0, std::ptr::null()) });
    if event.0.is_null() {
        return Err("capture_event_failed");
    }
    let format = WAVEFORMATEX {
        wFormatTag: 1,
        nChannels: protocol::CHANNELS,
        nSamplesPerSec: protocol::SAMPLE_RATE,
        nAvgBytesPerSec: protocol::SAMPLE_RATE * 4,
        nBlockAlign: 4,
        wBitsPerSample: 16,
        cbSize: 0,
    };
    unsafe {
        client
            .Initialize(
                AUDCLNT_SHAREMODE_SHARED,
                AUDCLNT_STREAMFLAGS_LOOPBACK
                    | AUDCLNT_STREAMFLAGS_EVENTCALLBACK
                    | AUDCLNT_STREAMFLAGS_AUTOCONVERTPCM,
                0,
                0,
                &format,
                None,
            )
            .map_err(|_| "capture_format_unsupported")?;
    }
    unsafe {
        client
            .SetEventHandle(windows::Win32::Foundation::HANDLE(event.0))
            .map_err(|_| "capture_event_failed")?;
    }
    let capture: IAudioCaptureClient = unsafe {
        client
            .GetService()
            .map_err(|_| "capture_initialization_failed")?
    };
    unsafe {
        client.Start().map_err(|_| "capture_start_failed")?;
    }
    let (frames, output) = mpsc::sync_channel::<Vec<u8>>(4);
    let failed_output = control.stopped.clone();
    thread::spawn(move || {
        let mut stdout = std::io::stdout().lock();
        while let Ok(bytes) = output.recv() {
            if stdout
                .write_all(&bytes)
                .and_then(|_| stdout.flush())
                .is_err()
            {
                failed_output.store(true, Ordering::Release);
                break;
            }
        }
    });
    protocol::status("ready", None);
    // Separate stdout/stderr pipes have no cross-pipe ordering. Wait for Main's
    // explicit acknowledgement so PCM cannot overtake the ready notification.
    while !control.running.load(Ordering::Acquire) {
        if let Some(reason) = control.reason(&target) {
            unsafe {
                let _ = client.Stop();
            }
            return Ok(reason);
        }
        thread::sleep(Duration::from_millis(5));
    }
    let result = capture_loop(&capture, &target, &control, &event, &frames);
    unsafe {
        let _ = client.Stop();
    }
    result
}

fn capture_loop(
    capture: &IAudioCaptureClient,
    target: &ProcessHandle,
    control: &Control,
    event: &ProcessHandle,
    output: &SyncSender<Vec<u8>>,
) -> Result<&'static str, &'static str> {
    let mut sequence = 0_u32;
    loop {
        if let Some(reason) = control.reason(target) {
            return Ok(reason);
        }
        let wait = unsafe { WaitForSingleObject(event.0, 50) };
        if wait == WAIT_FAILED {
            return Err("capture_wait_failed");
        }
        if wait != WAIT_OBJECT_0 {
            continue;
        }
        loop {
            if control.reason(target).is_some() {
                break;
            }
            if unsafe { capture.GetNextPacketSize() }.map_err(|_| "capture_device_invalidated")?
                == 0
            {
                break;
            }
            let mut data = std::ptr::null_mut();
            let mut count = 0_u32;
            let mut flags = 0_u32;
            unsafe {
                capture
                    .GetBuffer(&mut data, &mut count, &mut flags, None, None)
                    .map_err(|_| "capture_read_failed")?;
            }
            let copied = if count > 48_000 {
                Err("capture_packet_too_large")
            } else if count == 0 {
                Ok(Vec::new())
            } else if flags & AUDCLNT_BUFFERFLAGS_SILENT.0 as u32 != 0 {
                Ok(vec![0_u8; count as usize * 4])
            } else if data.is_null() {
                Err("capture_packet_missing")
            } else {
                Ok(unsafe { std::slice::from_raw_parts(data, count as usize * 4) }.to_vec())
            };
            unsafe {
                capture
                    .ReleaseBuffer(count)
                    .map_err(|_| "capture_release_failed")?;
            }
            for samples in copied?.chunks(protocol::MAX_FRAMES * 4) {
                if samples.is_empty() {
                    continue;
                }
                let packet = protocol::packet(samples, sequence);
                sequence = sequence.wrapping_add(1);
                match output.try_send(packet) {
                    Ok(_) | Err(mpsc::TrySendError::Full(_)) => {}
                    Err(mpsc::TrySendError::Disconnected(_)) => {
                        return Err("capture_output_closed");
                    }
                }
            }
        }
    }
}
