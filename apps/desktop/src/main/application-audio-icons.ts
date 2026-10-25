import path from "node:path";
import type { NativeApplicationAudioSource } from "./application-audio-sources";

export interface ApplicationAudioIcon {
  appIconDataUrl?: string;
}
/** Native process image paths stay in Main; no window capture or title matching. */
export async function readApplicationAudioIcons(
  rows: readonly NativeApplicationAudioSource[],
  readIcon: (executable: string) => Promise<string>,
): Promise<Map<string, ApplicationAudioIcon>> {
  const executables = [
    ...new Set(
      rows.flatMap((row) =>
        row.executablePath &&
        /^[A-Za-z]:\\/.test(row.executablePath) &&
        /\.exe$/i.test(row.executablePath)
          ? [path.win32.normalize(row.executablePath)]
          : [],
      ),
    ),
  ].slice(0, 64);
  const result = new Map<string, ApplicationAudioIcon>();
  for (let index = 0; index < executables.length; index += 6) {
    await Promise.all(
      executables.slice(index, index + 6).map(async (executable) => {
        try {
          const icon = await readIcon(executable);
          if (/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(icon) && icon.length <= 32768)
            result.set(executable, { appIconDataUrl: icon });
        } catch {
          /* Missing app icons do not prevent audio sharing. */
        }
      }),
    );
  }
  return result;
}
