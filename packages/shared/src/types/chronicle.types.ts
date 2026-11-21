export interface LocalChronicleEntry {
  id: string;
  at: number;
  text: string;
  reaction?: "funny" | "flat";
}

export const MAX_DAILY_CHRONICLE_ENTRIES = 1024;

const chronicleDateFormat = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Shanghai",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

export const getRoomChronicleDate = (at = Date.now()): string => chronicleDateFormat.format(at);

export interface RoomChronicleDay {
  date: string;
  entries: LocalChronicleEntry[];
}
export interface ChronicleArchiveApi {
  export(roomId: string, day?: RoomChronicleDay): Promise<{ saved: boolean }>;
  read(roomId: string): Promise<LocalChronicleEntry[]>;
  append(roomId: string, entries: LocalChronicleEntry[]): Promise<LocalChronicleEntry[]>;
  react(
    roomId: string,
    id: string,
    reaction?: LocalChronicleEntry["reaction"],
  ): Promise<LocalChronicleEntry[]>;
}
