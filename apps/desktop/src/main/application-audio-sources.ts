import { execFile } from "node:child_process";
import { release } from "node:os";
import { musicApplicationName } from "@private-voice/shared";
import { platformService } from "./platform/PlatformService";

export interface NativeApplicationAudioSource {
  pid: number;
  creationTime: string;
  processName: string;
  name: string;
  executablePath?: string;
}
export interface ApplicationAudioSourceOptions {
  executablePath: string;
  isWindows?: boolean;
  windowsBuild?: number;
  excludedPids?: ReadonlySet<number>;
  musicOnly?: boolean;
  listNativeSources?: () => Promise<NativeApplicationAudioSource[]>;
}

const blockedNames =
  /^(?:shanghao(?:-core)?|上号|electron|system|idle|dwm|explorer|sihost|svchost|csrss|winlogon|lsass|services|audiodg|applicationframehost|shellexperiencehost|startmenuexperiencehost|textinputhost|searchhost|runtimebroker)(?:\.exe)?$/i;

export const supportsApplicationAudio = (options: ApplicationAudioSourceOptions): boolean =>
  (options.isWindows ?? platformService.isWindows) &&
  (options.windowsBuild ?? Number(release().split(".")[2])) >= 20_348;

export async function readApplicationAudioSources(
  options: ApplicationAudioSourceOptions,
): Promise<NativeApplicationAudioSource[]> {
  const rows = options.listNativeSources
    ? await options.listNativeSources()
    : await new Promise<unknown>((resolve, reject) => {
        execFile(
          options.executablePath,
          ["--application-audio-sources"],
          { windowsHide: true, timeout: 5_000, maxBuffer: 1024 * 1024 },
          (error, stdout) => {
            if (error) {
              reject(new Error("native_application_audio_unavailable", { cause: error }));
              return;
            }
            try {
              resolve(JSON.parse(stdout).sources);
            } catch {
              reject(new Error("invalid_application_sources"));
            }
          },
        );
      });
  if (!Array.isArray(rows) || rows.length > 512) throw new Error("invalid_application_sources");
  return rows.filter(
    (row): row is NativeApplicationAudioSource =>
      Boolean(row) &&
      Number.isSafeInteger(row.pid) &&
      row.pid > 4 &&
      row.pid !== process.pid &&
      !options.excludedPids?.has(row.pid) &&
      typeof row.creationTime === "string" &&
      /^[1-9]\d{0,19}$/.test(row.creationTime) &&
      typeof row.name === "string" &&
      row.name.length > 0 &&
      row.name.length <= 256 &&
      typeof row.processName === "string" &&
      row.processName.length <= 256 &&
      !blockedNames.test(row.processName) &&
      (!options.musicOnly || Boolean(musicApplicationName(row.processName))),
  );
}
