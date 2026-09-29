import { createHash } from "node:crypto";

import { downloadVerifiedRuntimeArtifact } from "../src/main/runtime-artifact-download";

const destination = process.argv[2];
if (!destination || !process.send) throw new Error("runtime_artifact_worker_arguments_missing");
const content = Buffer.alloc(1024 * 1024, 0x61);
const digest = createHash("sha256").update(content).digest("hex");

const fetcher = async (): Promise<Response> => new Response(content);

const run = async (): Promise<void> => {
  try {
    process.send?.({ type: "ready" });
    await new Promise<void>((resolve) => {
      process.once("message", () => resolve());
    });
    await downloadVerifiedRuntimeArtifact({
      destination,
      expectedBytes: content.length,
      expectedSha256: digest,
      sources: [{ url: "https://example.invalid/runtime.whl" }],
      attempts: 2,
      fetcher,
    });
    process.send?.({ type: "result", ok: true }, () => process.disconnect());
  } catch (error) {
    process.send?.(
      { type: "result", ok: false, error: error instanceof Error ? error.message : String(error) },
      () => process.disconnect(),
    );
  }
};

void run();
