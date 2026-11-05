import { createRoot } from "react-dom/client";
import { StrictMode } from "react";
import type {
  AccountSnapshot,
  CloudAiAdminMutation,
  CloudAiAdminSnapshot,
} from "@private-voice/shared";
import { CloudAiAdminPanel } from "../../src/renderer/src/components/settings/CloudAiAdminPanel";
import { useAccountStore } from "../../src/renderer/src/store/accountStore";
import "../../src/renderer/src/styles/index.css";

const snapshot: CloudAiAdminSnapshot = { revision: 0, providers: [] };
let calls = 0;
Object.defineProperty(window, "desktopApi", {
  configurable: true,
  value: {
    cloudAiAdmin: {
      importKey: async () => {
        document.documentElement.dataset.imported = "true";
        return true;
      },
      get: async () => structuredClone(snapshot),
      change: async (mutation: CloudAiAdminMutation) => {
        document.documentElement.dataset.mutations = String(++calls);
        await new Promise((resolve) => setTimeout(resolve, 80));
        if (mutation.revision !== snapshot.revision) throw Error("cloud_ai_admin_conflict");
        if (mutation.action === "save") {
          const provider = {
            ...mutation.provider,
            id: mutation.provider.id ?? "synthetic-service",
            hasKey: true,
            active: false,
            fallback: snapshot.providers.find((p) => p.id === mutation.provider.id)?.fallback,
          };
          Reflect.deleteProperty(provider, "apiKey");
          snapshot.providers = [
            ...snapshot.providers.filter((p) => p.id !== provider.id),
            provider,
          ];
        } else if (mutation.action === "delete")
          snapshot.providers = snapshot.providers.filter((p) => p.id !== mutation.id);
        else if (mutation.action === "set-fallback" || mutation.action === "clear-fallback")
          snapshot.providers = snapshot.providers.map((p) => ({
            ...p,
            fallback: mutation.action === "set-fallback" && p.id === mutation.id,
          }));
        else
          snapshot.providers = snapshot.providers.map((p) =>
            p.id === mutation.id ? { ...p, active: mutation.action === "activate" } : p,
          );
        snapshot.revision++;
        return structuredClone(snapshot);
      },
    },
  },
});
useAccountStore.setState({
  snapshot: { status: "signed_in", profile: { userId: "synthetic-admin" } } as AccountSnapshot,
});
createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <CloudAiAdminPanel />
  </StrictMode>,
);
