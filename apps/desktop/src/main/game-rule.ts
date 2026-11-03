import type { GameDetectionSnapshot } from "@private-voice/shared";

export interface GameRule {
  name: NonNullable<GameDetectionSnapshot["gameName"]>;
  processNames: string[];
  titleNeedles?: string[];
  pathNeedles?: string[];
  commandLineNeedles?: string[];
  evidenceRequiredProcessNames?: string[];
}
