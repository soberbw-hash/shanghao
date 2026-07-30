declare module "deepfilternet3-noise-filter" {
  export interface DeepFilterNet3ProcessorConfig {
    sampleRate?: number;
    noiseReductionLevel?: number;
    assetConfig?: {
      cdnUrl?: string;
    };
  }

  export class DeepFilterNet3Core {
    constructor(config?: DeepFilterNet3ProcessorConfig);
    initialize(): Promise<void>;
    createAudioWorkletNode(audioContext: AudioContext): Promise<AudioWorkletNode>;
    destroy(): void;
    isReady(): boolean;
    setSuppressionLevel(level: number): void;
    setNoiseSuppressionEnabled(enabled: boolean): void;
  }
}
