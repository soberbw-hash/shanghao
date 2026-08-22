const SUPERSEDED_SESSION_ERROR = "signaling_session_superseded";

export const isSignalingSessionSupersededError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes(SUPERSEDED_SESSION_ERROR);
};
