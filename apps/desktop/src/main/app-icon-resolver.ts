import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import { app, nativeImage } from "electron";

import type { AppIdentity } from "./app-identity-resolver";
import { platformService } from "./platform/PlatformService";

const MAX_ACTIVITY_ICON_DATA_URL_LENGTH = 96_000;

export interface ResolvedAppIcon {
  dataUrl: string;
  hash: string;
  source: "appx-manifest" | "executable";
}

const toResolvedIcon = (
  dataUrl: string,
  source: ResolvedAppIcon["source"],
): ResolvedAppIcon | undefined => {
  if (!dataUrl.startsWith("data:image/") || dataUrl.length > MAX_ACTIVITY_ICON_DATA_URL_LENGTH) {
    return undefined;
  }
  return {
    dataUrl,
    hash: createHash("sha256").update(dataUrl).digest("hex"),
    source,
  };
};

export const scoreAppxAsset = (filename: string, baseName: string, extension: string): number => {
  const normalized = filename.toLocaleLowerCase();
  const expected = baseName.toLocaleLowerCase();
  if (!normalized.startsWith(expected) || !normalized.endsWith(extension.toLocaleLowerCase())) {
    return -1;
  }
  // Activity badges always use a light neutral surface. Windows Appx packages often ship
  // separate dark-on-transparent (lightunplated) and light-on-transparent variants; prefer
  // the former explicitly instead of depending on filesystem enumeration order.
  if (normalized.includes("targetsize-128") && normalized.includes("lightunplated")) return 120;
  if (normalized.includes("targetsize-64") && normalized.includes("lightunplated")) return 115;
  if (normalized.includes("targetsize-128") && normalized.includes("unplated")) return 110;
  if (normalized.includes("targetsize-64") && normalized.includes("unplated")) return 105;
  if (normalized.includes("targetsize-128")) return 90;
  if (normalized.includes("targetsize-64")) return 85;
  if (normalized.includes("scale-200")) return 80;
  if (normalized.includes("scale-150")) return 70;
  if (normalized === `${expected}${extension}`.toLocaleLowerCase()) return 60;
  return 10;
};

/** Resolves and caches one reliable 64px icon per stable application identity. */
export class AppIconResolver {
  private readonly cache = new Map<string, Promise<ResolvedAppIcon | undefined>>();

  resolve(identity?: AppIdentity): Promise<ResolvedAppIcon | undefined> {
    if (!identity || !platformService.isWindows) return Promise.resolve(undefined);
    const cached = this.cache.get(identity.key);
    if (cached) return cached;
    const pending = this.resolveUncached(identity).catch(() => undefined);
    this.cache.set(identity.key, pending);
    return pending;
  }

  clear(): void {
    this.cache.clear();
  }

  get size(): number {
    return this.cache.size;
  }

  private async resolveUncached(identity: AppIdentity): Promise<ResolvedAppIcon | undefined> {
    const appxIcon = await this.loadAppxManifestIcon(identity);
    if (appxIcon) return appxIcon;
    if (!identity.executablePath) return undefined;

    const icon = await app.getFileIcon(identity.executablePath, { size: "large" });
    if (icon.isEmpty()) return undefined;
    const dataUrl = icon.resize({ width: 64, height: 64, quality: "best" }).toDataURL();
    return toResolvedIcon(dataUrl, "executable");
  }

  private async loadAppxManifestIcon(identity: AppIdentity): Promise<ResolvedAppIcon | undefined> {
    if (!identity.packageRoot) return undefined;
    try {
      const manifest = await readFile(path.join(identity.packageRoot, "AppxManifest.xml"), "utf8");
      const manifestLogo =
        manifest.match(/Square44x44Logo="([^"]+)"/i)?.[1] ??
        manifest.match(/Square150x150Logo="([^"]+)"/i)?.[1] ??
        manifest.match(/<Logo>([^<]+)<\/Logo>/i)?.[1];
      if (!manifestLogo) return undefined;

      const relativeLogo = manifestLogo.replaceAll(/[\\/]/g, path.sep);
      const exactLogoPath = path.join(identity.packageRoot, relativeLogo);
      const parsedLogo = path.parse(exactLogoPath);
      const candidates = await readdir(parsedLogo.dir);
      const preferred = candidates
        .map((filename) => ({
          filename,
          score: scoreAppxAsset(filename, parsedLogo.name, parsedLogo.ext),
        }))
        .filter((candidate) => candidate.score >= 0)
        .sort((left, right) => right.score - left.score)[0];
      const icon = nativeImage.createFromPath(
        preferred ? path.join(parsedLogo.dir, preferred.filename) : exactLogoPath,
      );
      if (icon.isEmpty()) return undefined;
      const dataUrl = icon.resize({ width: 64, height: 64, quality: "best" }).toDataURL();
      return toResolvedIcon(dataUrl, "appx-manifest");
    } catch {
      return undefined;
    }
  }
}
