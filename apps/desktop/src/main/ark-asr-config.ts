export type ArkAsrQuantization = "q8_0" | "q6_k";

export interface ArkAsrVariant {
  displayQuantization: "Q8_0" | "Q6_K";
  repository: string;
  revision: string;
  fileName: string;
  fileSizeBytes: number;
  sha256: string;
}

/**
 * Keep quantization selection in one place. Q6_K is intentionally part of the
 * type so a later A/B pass can add a pinned artifact without changing the
 * download, runtime, benchmark, or export pipeline. This release registers
 * only the user-requested Q8_0 artifact.
 */
export const ARK_ASR_VARIANTS: Readonly<Partial<Record<ArkAsrQuantization, ArkAsrVariant>>> = {
  q8_0: {
    displayQuantization: "Q8_0",
    repository: "cstr/ark-asr-3b-GGUF",
    revision: "3f228f0d7835ded6e73f399286695534001e4cb2",
    fileName: "ark-asr-3b-q8_0.gguf",
    fileSizeBytes: 4_289_201_792,
    sha256: "b9ab32cfe7982eed5a596a601059e112d4aa5476e851852f944062a10fb25ee8",
  },
};

export const ACTIVE_ARK_ASR_QUANTIZATION: ArkAsrQuantization = "q8_0";

const activeArkAsrVariant = ARK_ASR_VARIANTS[ACTIVE_ARK_ASR_QUANTIZATION];

if (!activeArkAsrVariant) throw new Error("ark_asr_active_variant_missing");

export const ACTIVE_ARK_ASR_VARIANT: ArkAsrVariant = activeArkAsrVariant;
