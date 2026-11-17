export interface LocalChronicleEntry {
  id: string;
  at: number;
  text: string;
  reaction?: "funny" | "flat";
}
export interface ChronicleArchiveApi {
  export(roomId: string): Promise<{ saved: boolean }>;
  read(roomId: string): Promise<LocalChronicleEntry[]>;
  append(roomId: string, entries: LocalChronicleEntry[]): Promise<LocalChronicleEntry[]>;
  react(
    roomId: string,
    id: string,
    reaction?: LocalChronicleEntry["reaction"],
  ): Promise<LocalChronicleEntry[]>;
}
