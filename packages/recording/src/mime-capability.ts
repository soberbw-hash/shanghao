import {
  DIRECT_AAC_MIME_CANDIDATES,
  FALLBACK_RECORDING_MIME_CANDIDATES,
  RecordingEncoderState,
  type RecordingCapability,
} from "@private-voice/shared";

export const detectRecordingCapability = (): RecordingCapability => {
  if (typeof MediaRecorder === "undefined") {
    return {
      encoderState: RecordingEncoderState.Unsupported,
      requiresTranscode: false,
      supportedMimeTypes: [],
    };
  }

  const nativeMimeType = DIRECT_AAC_MIME_CANDIDATES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );

  if (nativeMimeType) {
    return {
      encoderState: RecordingEncoderState.NativeAacAvailable,
      requiresTranscode: false,
      mimeType: nativeMimeType,
      supportedMimeTypes: [...DIRECT_AAC_MIME_CANDIDATES],
    };
  }

  const fallbackMimeType = FALLBACK_RECORDING_MIME_CANDIDATES.find((mimeType) =>
    MediaRecorder.isTypeSupported(mimeType),
  );

  if (fallbackMimeType) {
    return {
      encoderState: RecordingEncoderState.FallbackTranscode,
      requiresTranscode: true,
      mimeType: fallbackMimeType,
      supportedMimeTypes: [...FALLBACK_RECORDING_MIME_CANDIDATES],
    };
  }

  return {
    encoderState: RecordingEncoderState.Unsupported,
    requiresTranscode: false,
    supportedMimeTypes: [],
  };
};
