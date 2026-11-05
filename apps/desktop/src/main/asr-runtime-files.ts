import { readdir, rm } from "node:fs/promises";
import path from "node:path";

/** Avoid provider-local Torch copies shadowing the pinned shared CUDA runtime. */
export async function removeProviderTorchCopies(providerPath: string): Promise<void> {
  const entries = await readdir(providerPath, { withFileTypes: true }).catch(() => []);
  const shadowing = entries.filter((entry) =>
    /^(torch|torchaudio|functorch)(?:$|[-_.])/i.test(entry.name),
  );
  await Promise.all(
    shadowing.map((entry) =>
      rm(path.join(providerPath, entry.name), { recursive: true, force: true }),
    ),
  );
}
