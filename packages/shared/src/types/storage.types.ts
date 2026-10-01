export interface StorageUsage {
  category: "models" | "runtimes" | "recordings" | "updates" | "temporary";
  bytes: number;
  files: number;
  complete: boolean;
}
export interface StorageApi {
  inspect: () => Promise<StorageUsage[]>;
  clearExpiredTemporary: () => Promise<{ removed: number; removedBytes: number }>;
}
