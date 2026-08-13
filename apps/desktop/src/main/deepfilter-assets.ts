import { app } from "electron";
import { access, readFile } from "node:fs/promises";
import path from "node:path";

import type { DeepFilterAssets } from "@private-voice/shared";

const EXPECTED_WASM_BYTES = 9_622_975;
const EXPECTED_MODEL_BYTES = 7_983_136;

let cachedAssets: Promise<DeepFilterAssets> | undefined;

const toExactArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

const resolveAssetDirectory = async (): Promise<string> => {
  if (app.isPackaged) return path.join(process.resourcesPath, "deepfilter");

  const candidates = [
    path.join(app.getAppPath(), "resources", "deepfilter"),
    path.join(process.cwd(), "resources", "deepfilter"),
    path.join(process.cwd(), "apps", "desktop", "resources", "deepfilter"),
  ];
  for (const candidate of candidates) {
    try {
      await access(path.join(candidate, "df_bg.wasm"));
      await access(path.join(candidate, "DeepFilterNet3_onnx.tar.gz"));
      return candidate;
    } catch {
      // Continue through the known development working-directory layouts.
    }
  }
  return candidates[0] ?? path.join(app.getAppPath(), "resources", "deepfilter");
};

const readAssets = async (): Promise<DeepFilterAssets> => {
  const directory = await resolveAssetDirectory();
  const [wasm, model] = await Promise.all([
    readFile(path.join(directory, "df_bg.wasm")),
    readFile(path.join(directory, "DeepFilterNet3_onnx.tar.gz")),
  ]);

  if (wasm.byteLength !== EXPECTED_WASM_BYTES || model.byteLength !== EXPECTED_MODEL_BYTES) {
    throw new Error(`deepfilter_asset_size_mismatch:${wasm.byteLength}:${model.byteLength}`);
  }

  return {
    wasm: toExactArrayBuffer(wasm),
    model: toExactArrayBuffer(model),
  };
};

export const readDeepFilterAssets = (): Promise<DeepFilterAssets> => {
  cachedAssets ??= readAssets().catch((error) => {
    cachedAssets = undefined;
    throw error;
  });
  return cachedAssets;
};
