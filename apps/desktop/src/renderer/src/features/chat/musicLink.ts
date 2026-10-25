interface MusicLink {
  platform: string;
  url: string;
}
const platforms: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["QQ 音乐", ["y.qq.com"]],
  ["网易云音乐", ["music.163.com", "163cn.tv"]],
  ["Apple Music", ["music.apple.com"]],
  ["酷狗音乐", ["kugou.com"]],
  ["Spotify", ["open.spotify.com", "spotify.link"]],
  ["汽水音乐", ["qishui.douyin.com", "qishui.com"]],
];
/** Identification only. Opening/preview still uses the existing safe URL boundary. */
export function identifyMusicLink(value: string): MusicLink | undefined {
  try {
    const url = new URL(value);
    if (!["https:", "http:"].includes(url.protocol) || url.username || url.password || url.port)
      return;
    const hostname = url.hostname.toLowerCase();
    const found = platforms.find(([, hosts]) =>
      hosts.some((host) => hostname === host || hostname.endsWith(`.${host}`)),
    );
    return found ? { platform: found[0], url: url.href } : undefined;
  } catch {
    return;
  }
}
