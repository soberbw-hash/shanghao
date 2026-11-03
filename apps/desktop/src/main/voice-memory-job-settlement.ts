/** Bound cancelled job settlement without retaining a timer after an early completion. */
export async function settleVoiceMemoryJob(job: Promise<unknown> | undefined): Promise<void> {
  if (!job) return;
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      job.catch(() => undefined),
      new Promise<void>((resolve) => {
        timer = setTimeout(resolve, 4_000);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
