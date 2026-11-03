import type { GameRule } from "./game-catalog";

const emulatorProcesses = [
  "aow_exe",
  "androidemulator",
  "androidemulatorex",
  "androidemulatoren",
  "dnplayer",
  "ldplayer",
  "hd-player",
];
export const EMULATOR_GAME_RULES: GameRule[] = [
  {
    name: "和平精英",
    processNames: emulatorProcesses,
    titleNeedles: ["和平精英", "game for peace"],
    commandLineNeedles: ["com.tencent.tmgp.pubgmhd"],
    evidenceRequiredProcessNames: emulatorProcesses,
  },
];
