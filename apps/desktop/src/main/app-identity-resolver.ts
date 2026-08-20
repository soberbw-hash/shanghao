import path from "node:path";

export interface AppIdentityEvidence {
  processName?: string;
  executablePath?: string;
  productName?: string;
  fileDescription?: string;
  packageFamilyName?: string;
  appUserModelId?: string;
  windowOwnerProcessName?: string;
  parentProcessId?: number;
}

export interface AppIdentity {
  key: string;
  processName: string;
  executableName: string;
  executablePath?: string;
  productName?: string;
  fileDescription?: string;
  packageFamilyName?: string;
  appUserModelId?: string;
  windowOwnerProcessName?: string;
  parentProcessId?: number;
  packageRoot?: string;
}

const normalizeName = (value?: string): string =>
  (value ?? "")
    .trim()
    .toLocaleLowerCase()
    .replace(/\.exe$/i, "");

const resolveWindowsAppsPackageRoot = (executablePath?: string): string | undefined => {
  if (!executablePath) return undefined;
  const normalized = executablePath.replaceAll("/", "\\");
  const marker = "\\WindowsApps\\";
  const markerIndex = normalized.toLocaleLowerCase().indexOf(marker.toLocaleLowerCase());
  if (markerIndex < 0) return undefined;
  const packageStart = markerIndex + marker.length;
  const packageEnd = normalized.indexOf("\\", packageStart);
  if (packageEnd < 0) return undefined;
  return normalized.slice(0, packageEnd);
};

/** Builds a stable application identity from every safe bit of process evidence available. */
export class AppIdentityResolver {
  resolve(evidence: AppIdentityEvidence): AppIdentity | undefined {
    const processName = normalizeName(evidence.processName);
    const executableName = normalizeName(
      evidence.executablePath ? path.basename(evidence.executablePath) : undefined,
    );
    if (
      !processName &&
      !executableName &&
      !evidence.appUserModelId &&
      !evidence.packageFamilyName
    ) {
      return undefined;
    }

    const executablePath = evidence.executablePath?.trim() || undefined;
    const key = [
      evidence.packageFamilyName?.trim().toLocaleLowerCase(),
      evidence.appUserModelId?.trim().toLocaleLowerCase(),
      executablePath?.toLocaleLowerCase(),
      executableName,
      processName,
    ]
      .filter(Boolean)
      .join("|");

    return {
      key,
      processName,
      executableName,
      executablePath,
      productName: evidence.productName?.trim() || undefined,
      fileDescription: evidence.fileDescription?.trim() || undefined,
      packageFamilyName: evidence.packageFamilyName?.trim() || undefined,
      appUserModelId: evidence.appUserModelId?.trim() || undefined,
      windowOwnerProcessName: normalizeName(evidence.windowOwnerProcessName) || undefined,
      parentProcessId: evidence.parentProcessId,
      packageRoot: resolveWindowsAppsPackageRoot(executablePath),
    };
  }
}

export const appIdentityMatches = (identity: AppIdentity, candidates: string[]): boolean => {
  const names = [
    identity.processName,
    identity.executableName,
    normalizeName(identity.productName),
    normalizeName(identity.fileDescription),
  ];
  return candidates.some((candidate) => names.includes(normalizeName(candidate)));
};
