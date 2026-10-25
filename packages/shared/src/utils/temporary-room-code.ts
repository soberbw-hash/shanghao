/** Keep digit codes as strings: numeric coercion loses valid leading zeroes. */
export const normalizeTemporaryRoomCode = (value: unknown): string | undefined => {
  if (typeof value !== "string" || value.length > 64) return undefined;
  const code = value.replace(/\s/g, "");
  return /^[0-9]{8}$/.test(code) ? code : undefined;
};

export const formatTemporaryRoomCode = (value: string): string => {
  const code = normalizeTemporaryRoomCode(value);
  if (!code) throw new Error("temporary_room_code_invalid");
  return `${code.slice(0, 4)} ${code.slice(4)}`;
};
