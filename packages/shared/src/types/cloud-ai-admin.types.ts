export interface CloudAiAdminProvider {
  id: string;
  kind: "text" | "speech";
  name: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  active: boolean;
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
      provider: Omit<CloudAiAdminProvider, "id" | "hasKey" | "active"> & {
        id?: string;
        apiKey?: string;
      };
    }
  | { action: "activate" | "delete" | "disable"; id: string }
);
