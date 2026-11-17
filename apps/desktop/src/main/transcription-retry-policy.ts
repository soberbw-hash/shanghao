const MAX_ATTEMPTS = 3;
export function transcriptionAttemptLimit(benchmark = false, remaining = MAX_ATTEMPTS): number {
  return Math.max(1, Math.min(remaining, benchmark ? 2 : MAX_ATTEMPTS));
}

export const isFatalTranscriptionRuntimeFailure = (error: unknown): boolean => {
  const message = (error instanceof Error ? error.message : String(error)).toLowerCase();
  return /(?:0xc000001d|-1073741795|3221225501|illegal instruction|ark_asr_(?:backend_missing|q8_model_missing|q8_quantization_required)|unable to compare versions for packaging|no package metadata was found|modulenotfounderror|no module named|importerror:|dll load failed)/i.test(
    message,
  );
};
