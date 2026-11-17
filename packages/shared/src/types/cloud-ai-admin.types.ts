export interface CloudAiAdminProvider {
  id: string;
  kind: "text" | "speech";
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  active: boolean;
  /** An inactive provider explicitly selected for failover within its own kind. */
  fallback?: boolean;
}
export interface CloudAiAdminSnapshot {
  revision: number;
  providers: CloudAiAdminProvider[];
}
export type CloudAiAdminMutation = {
  revision: number;
} & (
  | {
      action: "save";
      provider: Omit<CloudAiAdminProvider, "id" | "hasKey" | "active" | "fallback"> & {
        id?: string;
        apiKey?: string;
      };
    }
  | { action: "activate" | "delete" | "disable" | "set-fallback" | "clear-fallback"; id: string }
);
