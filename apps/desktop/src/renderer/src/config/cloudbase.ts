import type { CloudBaseClientConfig } from "@private-voice/shared";

const envId = import.meta.env.VITE_CLOUDBASE_ENV_ID?.trim();
const region = import.meta.env.VITE_CLOUDBASE_REGION?.trim();
const publishableKey = import.meta.env.VITE_CLOUDBASE_PUBLISHABLE_KEY?.trim();

export const cloudBaseClientConfig: CloudBaseClientConfig | undefined =
  envId && region && publishableKey ? { envId, region, publishableKey } : undefined;
