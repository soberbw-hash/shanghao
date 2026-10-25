use std::{
    mem::ManuallyDrop,
    sync::{
        Mutex,
        mpsc::{self, SyncSender},
    },
    time::{Duration, Instant},
};
use windows::{
    Win32::{
        Media::Audio::*,
        System::{
            Com::{
                COINIT_MULTITHREADED, CoInitializeEx, CoUninitialize,
                StructuredStorage::PROPVARIANT,
            },
            Variant::VT_BLOB,
        },
    },
    core::{HRESULT, Interface, Ref, implement},
};

// ActivateCompleted runs in the process MTA. The capture thread joins that same
// MTA before activation, so no inter-apartment marshaler is required. IAudioClient
// lacks a registered proxy on some supported Windows builds (REGDB_E_IIDNOTREG).
struct MtaAudioClient(IAudioClient);
// SAFETY: this private wrapper travels only from the MTA callback to activate's
// caller, whose Apartment guard remains alive until every audio client is dropped.
unsafe impl Send for MtaAudioClient {}
type Activated = Result<MtaAudioClient, HRESULT>;

#[implement(IActivateAudioInterfaceCompletionHandler)]
struct Completion {
    sender: Mutex<Option<SyncSender<Activated>>>,
    // Windows may complete after cancellation. The callback owns its parameter allocation.
    _params: Box<AUDIOCLIENT_ACTIVATION_PARAMS>,
}
impl IActivateAudioInterfaceCompletionHandler_Impl for Completion_Impl {
    fn ActivateCompleted(
        &self,
        operation: Ref<IActivateAudioInterfaceAsyncOperation>,
    ) -> windows::core::Result<()> {
        let result = (|| unsafe {
            let mut result = HRESULT(0);
            let mut interface = None;
            operation
                .ok()?
                .GetActivateResult(&mut result, &mut interface)?;
            result.ok()?;
            let client = interface
                .ok_or_else(windows::core::Error::from_thread)?
                .cast::<IAudioClient>()?;
            Ok(MtaAudioClient(client))
        })()
        .map_err(|error: windows::core::Error| {
            eprintln!("{}", serde_json::json!({"type":"diagnostic","stage":"activation_callback","hresult":format!("{:08x}", error.code().0)}));
            error.code()
        });
        if let Ok(mut sender) = self.sender.lock() {
            if let Some(sender) = sender.take() {
                let _ = sender.try_send(result);
            }
        }
        Ok(())
    }
}

pub struct Apartment(std::marker::PhantomData<*mut ()>);
impl Apartment {
    pub fn new() -> Result<Self, &'static str> {
        unsafe {
            CoInitializeEx(None, COINIT_MULTITHREADED)
                .ok()
                .map_err(|_| "com_initialization_failed")?;
        }
        Ok(Self(std::marker::PhantomData))
    }
}
impl Drop for Apartment {
    fn drop(&mut self) {
        unsafe {
            CoUninitialize();
        }
    }
}

pub fn activate(
    _apartment: &Apartment,
    pid: u32,
    canceled: impl Fn() -> bool,
) -> Result<Option<IAudioClient>, &'static str> {
    let mut params = Box::new(AUDIOCLIENT_ACTIVATION_PARAMS {
        ActivationType: AUDIOCLIENT_ACTIVATION_TYPE_PROCESS_LOOPBACK,
        Anonymous: AUDIOCLIENT_ACTIVATION_PARAMS_0 {
            ProcessLoopbackParams: AUDIOCLIENT_PROCESS_LOOPBACK_PARAMS {
                TargetProcessId: pid,
                ProcessLoopbackMode: PROCESS_LOOPBACK_MODE_INCLUDE_TARGET_PROCESS_TREE,
            },
        },
    });
    // VT_BLOB borrows the callback-owned Rust allocation. PROPVARIANT's Drop
    // calls PropVariantClear/CoTaskMemFree, which must never free this Box.
    let mut variant = ManuallyDrop::new(PROPVARIANT::default());
    unsafe {
        let blob_variant = &mut *variant.Anonymous.Anonymous;
        blob_variant.vt = VT_BLOB;
        blob_variant.Anonymous.blob = windows::Win32::System::Com::BLOB {
            cbSize: size_of::<AUDIOCLIENT_ACTIVATION_PARAMS>() as u32,
            pBlobData: (&mut *params as *mut AUDIOCLIENT_ACTIVATION_PARAMS).cast(),
        };
    }
    let (sender, receiver) = mpsc::sync_channel(1);
    let callback: IActivateAudioInterfaceCompletionHandler = Completion {
        sender: Mutex::new(Some(sender)),
        _params: params,
    }
    .into();
    let _operation = unsafe {
        ActivateAudioInterfaceAsync(
            VIRTUAL_AUDIO_DEVICE_PROCESS_LOOPBACK,
            &IAudioClient::IID,
            Some(&*variant),
            &callback,
        )
    }
    .map_err(|error| {
        eprintln!("{}", serde_json::json!({"type":"diagnostic","stage":"activation_request","hresult":format!("{:08x}", error.code().0)}));
        "activation_failed"
    })?;
    let deadline = Instant::now() + Duration::from_secs(6);
    loop {
        if canceled() {
            return Ok(None);
        }
        match receiver.recv_timeout(Duration::from_millis(25)) {
            Ok(Ok(client)) => return Ok(Some(client.0)),
            Ok(Err(_)) => return Err("activation_failed"),
            Err(mpsc::RecvTimeoutError::Disconnected) => return Err("activation_failed"),
            Err(_) if Instant::now() >= deadline => return Err("activation_timeout"),
            Err(_) => {}
        }
    }
}
