import {
  DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID,
  type AiModelId,
  type AiModelStatus,
} from "@private-voice/shared";

type ModelState = Pick<
  AiModelStatus,
  "userInstalled" | "activeRevision" | "phase" | "failureKind" | "downloadedBytes" | "totalBytes"
>;

/** Distinguish an interrupted transfer from an explicit pause across restarts. */
export function restoreModelDownload(
  model: Partial<ModelState> | undefined,
  id: AiModelId,
  interrupted: AiModelId[],
): boolean {
  if (
    model &&
    ["queued", "checking", "downloading", "verifying", "preparing"].includes(model.phase ?? "")
  ) {
    model.phase = "paused";
    interrupted.push(id);
  }
  return Boolean(
    model?.userInstalled &&
    !model.activeRevision &&
    model.phase !== "paused" &&
    (model.phase !== "error" ||
      model.failureKind !== "integrity" ||
      (Boolean(model.totalBytes) && model.downloadedBytes === model.totalBytes)) &&
    !interrupted.includes(id),
  );
}

/** One-time baseline opt-in; later explicit pauses and removals are authoritative. */
export async function requestBaselineAsr(
  ready: boolean,
  state: { baselineAsrRequested?: boolean },
  model: (id: AiModelId) => Partial<ModelState> & { userInstalled: boolean },
  persist: () => Promise<void>,
  start: (id: AiModelId) => void,
  dependencies: readonly AiModelId[],
): Promise<boolean> {
  if (!ready) throw new Error("ai_model_state_unavailable");
  const primary = model(DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID);
  if (state.baselineAsrRequested) return primary.userInstalled;
  state.baselineAsrRequested = true;
  const ids = [DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID, ...dependencies];
  if (primary.phase !== "paused") for (const id of ids) model(id).userInstalled = true;
  await persist();
  if (primary.phase !== "paused")
    for (const id of ids) {
      const item = model(id);
      if (!item.activeRevision && item.phase !== "paused") start(id);
    }
  return true;
}
