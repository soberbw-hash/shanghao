import {
  DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID,
  type AiModelAction,
  type AiModelStatus,
} from "@private-voice/shared";

export function baselineAsrStatus(models: AiModelStatus[]): AiModelStatus | undefined {
  const model = models.find((item) => item.id === DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID);
  if (!model || model.phase === "paused" || !model.userInstalled) return model;
  const dependencies = (model.dependencies ?? []).map((id) =>
    models.find((item) => item.id === id),
  );
  if (dependencies.some((item) => item && !item.userInstalled))
    return { ...model, userInstalled: false, runtimeReady: false };
  const missing = dependencies.find((item) => !item?.activeRevision);
  if (dependencies.some((item) => !item?.activeRevision))
    return {
      ...model,
      activeRevision: undefined,
      phase: missing?.phase ?? "not_installed",
      failureKind: missing?.failureKind,
      runtimeReady: false,
    };
  return {
    ...model,
    runtimeReady: model.runtimeReady && dependencies.every((item) => item?.runtimeReady),
  };
}

/** Baseline preparation is independent of cloud jobs and never holds their queue. */
export function createDefaultAsrProvisioner(host: {
  enabled: () => boolean;
  model: () => AiModelStatus | undefined;
  optIn: () => Promise<boolean>;
  control: (action: AiModelAction) => Promise<unknown>;
  canPrepare: () => boolean;
  canAssist?: () => boolean;
  onReady: () => void;
  now?: () => number;
}) {
  const now = host.now ?? Date.now;
  let stopped = false,
    running = false,
    requested = false,
    wasReady = false;
  let nextAttempt = 0,
    networkAttempts = 0,
    repairAttempts = 0;
  let timer: NodeJS.Timeout | undefined;
  const schedule = (delay = 1000) => {
    if (stopped || timer) return;
    timer = setTimeout(() => {
      timer = undefined;
      void check();
    }, delay);
    timer.unref();
  };
  const check = async () => {
    if (stopped || !host.enabled()) return;
    if (running) {
      requested = true;
      return;
    }
    running = true;
    try {
      if (!(await host.optIn()) || stopped || !host.enabled()) return;
      const model = host.model();
      const ready = Boolean(model?.activeRevision && model.runtimeReady);
      if (ready) {
        if (!(host.canAssist?.() ?? host.canPrepare())) {
          wasReady = false;
          schedule(15000);
          return;
        }
        if (!wasReady) host.onReady();
        wasReady = true;
        return;
      }
      wasReady = false;
      // Installed by the baseline, but subsequently paused/removed by the user.
      if (!model?.userInstalled || model.phase === "paused") return;
      if (["queued", "checking", "downloading", "verifying", "preparing"].includes(model.phase))
        return;
      if (nextAttempt > now()) {
        schedule(nextAttempt - now());
        return;
      }
      if (!host.canPrepare()) {
        schedule(15000);
        return;
      }
      if (!model.activeRevision) {
        if (model.phase === "error" && !["network", "download"].includes(model.failureKind ?? ""))
          return;
        nextAttempt = now() + Math.min(300000, 15000 * 2 ** Math.min(networkAttempts++, 5));
        await host.control("download");
      } else if (repairAttempts < 2) {
        repairAttempts++;
        nextAttempt = now() + 60000;
        await host.control("repair");
      }
    } catch {
      // Error remains visible in model status; never fail or delay a cloud transcript.
    } finally {
      running = false;
      if (requested) {
        requested = false;
        schedule();
      } else if (!stopped && host.enabled() && nextAttempt > now()) schedule(nextAttempt - now());
    }
  };
  return {
    modelId: DEFAULT_CLOUD_LOCAL_ASR_MODEL_ID,
    check,
    refresh: () => {
      requested = true;
      schedule();
    },
    stop: () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      timer = undefined;
    },
  };
}
