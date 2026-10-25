/** A browser can contain private calls or unrelated tabs, so it is not a music source. */
const musicApplications: Readonly<Record<string, string>> = {
  "cloudmusic.exe": "网易云音乐",
  "qqmusic.exe": "QQ音乐",
  "applemusic.exe": "Apple Music",
  "apple music.exe": "Apple Music",
  "spotify.exe": "Spotify",
  "kugou.exe": "酷狗音乐",
  "kwmusic.exe": "酷我音乐",
  "kuwo.exe": "酷我音乐",
  "soda music.exe": "汽水音乐",
  "sodamusic.exe": "汽水音乐",
  "qishui.exe": "汽水音乐",
  "qishuimusic.exe": "汽水音乐",
};

export const musicApplicationName = (processName: string): string | undefined =>
  musicApplications[processName.toLowerCase()];
