import { constants } from "node:fs";
import { access, mkdir } from "node:fs/promises";
import path from "node:path";

export const RECORDING_DIRECTORY_NAME = "上号录音";
const INVALID_WINDOWS_FILE_NAME_CHARACTERS = new Set([
  "<",
  ">",
  ":",
  '"',
  "/",
  "\\",
  "|",
  "?",
  "*",
]);

export const resolveRecordingDirectory = (
  configuredDirectory: string | undefined,
  documentsDirectory: string,
): string => {
  const candidate = configuredDirectory?.trim();
  return candidate && path.isAbsolute(candidate)
    ? path.normalize(candidate)
    : path.join(documentsDirectory, RECORDING_DIRECTORY_NAME);
};

type EnsureRecordingDirectory = (directory: string) => Promise<void>;

const ensureRecordingDirectory: EnsureRecordingDirectory = async (directory) => {
  await mkdir(directory, { recursive: true });
  await access(directory, constants.R_OK | constants.W_OK);
};

export const resolveUsableRecordingDirectory = async (
  configuredDirectory: string | undefined,
  documentsDirectory: string,
  ensureDirectory: EnsureRecordingDirectory = ensureRecordingDirectory,
): Promise<string> => {
  const fallbackDirectory = path.join(documentsDirectory, RECORDING_DIRECTORY_NAME);
  const preferredDirectory = resolveRecordingDirectory(configuredDirectory, documentsDirectory);

  try {
    await ensureDirectory(preferredDirectory);
    return preferredDirectory;
  } catch (error) {
    if (preferredDirectory === fallbackDirectory) throw error;
    await ensureDirectory(fallbackDirectory);
    return fallbackDirectory;
  }
};

export const sanitizeRecordingFileName = (suggestedFileName: string): string => {
  const baseName = path
    .basename(suggestedFileName || "上号录音.m4a")
    .split("")
    .map((character) =>
      character.charCodeAt(0) <= 31 || INVALID_WINDOWS_FILE_NAME_CHARACTERS.has(character)
        ? "-"
        : character,
    )
    .join("")
    .replace(/[. ]+$/g, "")
    .slice(0, 120);
  const withoutExtension = baseName.replace(/\.m4a$/i, "") || "上号录音";
  return `${withoutExtension}.m4a`;
};

const formatLocalDatePart = (date: Date): string =>
  [date.getFullYear(), date.getMonth() + 1, date.getDate()]
    .map((value, index) => String(value).padStart(index === 0 ? 4 : 2, "0"))
    .join("-");

const formatLocalTimePart = (date: Date): string =>
  [date.getHours(), date.getMinutes(), date.getSeconds()]
    .map((value) => String(value).padStart(2, "0"))
    .join("-");

export const createNumberedRecordingFileName = (
  createdAt: Date,
  existingFileNames: string[],
): string => {
  const datePart = formatLocalDatePart(createdAt);
  const matchingNames = existingFileNames.filter(
    (fileName) => fileName.toLowerCase().endsWith(".m4a") && fileName.includes(datePart),
  );
  const numberedTailPattern = /-(?:语音|一号房|二号房)-(\d{2,3})-\d{2}-\d{2}-\d{2}\.m4a$/i;
  const largestExistingNumber = matchingNames.reduce((largest, fileName) => {
    const match = numberedTailPattern.exec(fileName);
    return match?.[1] ? Math.max(largest, Number(match[1])) : largest;
  }, 0);
  const sequence = Math.max(matchingNames.length, largestExistingNumber) + 1;
  return `上号-${datePart}-语音-${String(sequence).padStart(2, "0")}-${formatLocalTimePart(createdAt)}.m4a`;
};

export const resolveAvailableRecordingPath = async (
  directory: string,
  suggestedFileName: string,
  pathExists: (candidate: string) => Promise<boolean>,
): Promise<string> => {
  const safeFileName = sanitizeRecordingFileName(suggestedFileName);
  const extension = path.extname(safeFileName);
  const stem = path.basename(safeFileName, extension);

  for (let suffix = 0; suffix < 1_000; suffix += 1) {
    const candidate = path.join(
      directory,
      suffix === 0 ? safeFileName : `${stem} (${suffix + 1})${extension}`,
    );
    if (!(await pathExists(candidate))) return candidate;
  }

  return path.join(directory, `${stem}-${Date.now()}${extension}`);
};
