export const GITHUB_URL = "https://github.com/soberbw-hash/shanghao";
export const RELEASES_URL = `${GITHUB_URL}/releases/latest`;
export type ReleaseAsset = {
  name: string; browser_download_url: string; size: number;
  mirror_path?: string; sha256?: string;
};
export type Release = { tag_name: string; published_at: string; html_url: string; assets: ReleaseAsset[] };

export function downloadUrl(asset: ReleaseAsset): string {
  // Only allow versioned same-origin mirrors, never arbitrary URLs from manifest fields.
  return asset.mirror_path?.match(/^\/downloads\/v\d+\.\d+\.\d+\/[A-Za-z0-9._-]+\.exe$/)
    ? asset.mirror_path : asset.browser_download_url;
}

export async function loadRelease(signal: AbortSignal): Promise<Release | null> {
  // Same-origin metadata works even when GitHub is slow or unreachable in China.
  for (const url of ["/release.json", "https://api.github.com/repos/soberbw-hash/shanghao/releases/latest"]) {
    try {
      const response = await fetch(url, {
        cache: "no-cache", signal: AbortSignal.any([signal, AbortSignal.timeout(8000)]),
      });
      if (!response.ok) continue;
      const release = await response.json();
      if (release.draft || release.prerelease || typeof release.tag_name !== "string" ||
          !Array.isArray(release.assets) || !release.assets.length) continue;
      return release;
    } catch { if (signal.aborted) return null; }
  }
  return null;
}
