import { InlineBanner } from "../layout/InlineBanner";

export const RecordingErrorBanner = ({ message }: { message?: string }) =>
  message ? <InlineBanner tone="danger">{message}</InlineBanner> : null;
