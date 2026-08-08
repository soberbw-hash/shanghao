import { parsePowerShellJson, runWindowsPowerShell } from "./windows-command";

export interface WindowsElevationStatus {
  isElevated: boolean;
  identity?: string;
  method: "windows-token" | "not-windows" | "unavailable";
}

const ELEVATION_SCRIPT = String.raw`
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = [Security.Principal.WindowsPrincipal]::new($identity)
$isAdmin = $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
@{ isElevated = $isAdmin; identity = $identity.Name } | ConvertTo-Json -Compress
`;

let cachedStatus: WindowsElevationStatus | undefined;

export const readWindowsElevationStatus = async (
  refresh = false,
): Promise<WindowsElevationStatus> => {
  if (!refresh && cachedStatus) return cachedStatus;
  if (process.platform !== "win32") {
    cachedStatus = { isElevated: false, method: "not-windows" };
    return cachedStatus;
  }

  try {
    const result = await runWindowsPowerShell(ELEVATION_SCRIPT);
    const parsed = parsePowerShellJson<{ isElevated?: boolean; identity?: string }>(result.stdout);
    cachedStatus = {
      isElevated: parsed.isElevated === true,
      identity: parsed.identity,
      method: "windows-token",
    };
  } catch {
    cachedStatus = { isElevated: false, method: "unavailable" };
  }
  return cachedStatus;
};
