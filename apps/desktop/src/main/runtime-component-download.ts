import {
  downloadVerifiedRuntimeArtifact,
  type RuntimeArtifactSource,
  type RuntimeArtifactFetcher,
} from "./runtime-artifact-download";

export interface RuntimeComponentArtifact {
  bytes: number;
  sha256: string;
  sources: readonly RuntimeArtifactSource[];
}

/** One immutable download policy shared by provider wheels and portable helpers. */
export const downloadRuntimeComponent = (
  artifact: RuntimeComponentArtifact,
  destination: string,
  options: {
    signal?: AbortSignal;
    fetcher?: RuntimeArtifactFetcher;
    consumeBytes?: (bytes: number, signal?: AbortSignal) => Promise<void>;
    onRetry: (context: {
      attempt: number;
      source: RuntimeArtifactSource;
      error: unknown;
    }) => Promise<void>;
  },
): Promise<string> =>
  downloadVerifiedRuntimeArtifact({
    destination,
    expectedBytes: artifact.bytes,
    expectedSha256: artifact.sha256,
    sources: artifact.sources,
    attempts: 6,
    idleTimeoutMs: 120_000,
    ...options,
  });
