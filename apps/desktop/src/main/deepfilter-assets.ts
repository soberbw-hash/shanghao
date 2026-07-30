import { app } from "electron";
import { readFile } from "node:fs/promises";
import path from "node:path";

import type { DeepFilterAssets } from "@private-voice/shared";

const EXPECTED_WASM_BYTES = 9_622_975;
const EXPECTED_MODEL_BYTES = 7_983_136;

let cachedAssets: Promise<DeepFilterAssets> | undefined;

const toExactArrayBuffer = (buffer: Buffer): ArrayBuffer =>
  buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength) as ArrayBuffer;

const resolveAssetDirectory = (): string =>
  app.isPackaged
    ? path.join(process.resourcesPath, "deepfilter")
    : path.join(app.getAppPath(), "resources", "deepfilter");

const readAssets = async (): Promise<DeepFilterAssets> => {
  const directory = resolveAssetDirectory();
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
