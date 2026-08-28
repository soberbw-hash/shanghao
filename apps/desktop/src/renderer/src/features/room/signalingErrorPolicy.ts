import type { ErrorMessage } from "@private-voice/signaling";

export interface SignalingErrorDecision {
  ignore: boolean;
  stopReconnect: boolean;
  reason?: string;
  updateRequired?: { requiredVersion: string; currentVersion: string };
  avatarConflict?: { availableAvatarIds: ErrorMessage["availableAvatarIds"] };
}

/** Converts server error envelopes into room lifecycle decisions without side effects. */
export const decideSignalingError = (
  payload: ErrorMessage,
  context: {
    hasJoinedOnce: boolean;
    joinAckReceived: boolean;
    appVersion: string;
  },
): SignalingErrorDecision => {
  if (payload.code === "CLIENT_UPDATE_REQUIRED") {
    return {
      ignore: false,
      stopReconnect: true,
      reason: "CLIENT_UPDATE_REQUIRED",
      updateRequired: {
        requiredVersion: payload.requiredVersion ?? "未知",
        currentVersion: payload.currentVersion ?? context.appVersion,
      },
    };
  }
  if (payload.code === "version_mismatch") {
    return {
      ignore: false,
      stopReconnect: true,
      reason: "relay_protocol_mismatch",
    };
  }
  if (payload.code === "avatar_taken" && context.hasJoinedOnce) {
    return {
      ignore: true,
      stopReconnect: false,
      avatarConflict: { availableAvatarIds: payload.availableAvatarIds },
    };
  }
  if (payload.code === "invalid_payload" && context.hasJoinedOnce && context.joinAckReceived) {
    return { ignore: true, stopReconnect: false };
  }

  const isProtocolRejected = [
    "4400",
    "invalid_message",
    "unsupported_protocol",
    "reconnect_session_invalid",
    "reconnect_session_expired",
  ].includes(payload.code);
  return {
    ignore: false,
    stopReconnect: isProtocolRejected || payload.code === "avatar_taken",
    reason: isProtocolRejected
      ? "signaling_protocol_rejected"
      : payload.code === "avatar_taken"
        ? "avatar_taken"
        : payload.message || payload.code,
  };
};
