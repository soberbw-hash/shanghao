import type { RecordingLibrarySnapshot } from "@private-voice/shared";

export const createRecordingLibraryCache = (list: () => Promise<RecordingLibrarySnapshot>) => {
  let snapshot: RecordingLibrarySnapshot | undefined;
  let request: Promise<RecordingLibrarySnapshot> | undefined;
  let generation = 0;
  return {
    peek: () => snapshot,
    read(refresh = false): Promise<RecordingLibrarySnapshot> {
      if (refresh) {
        generation += 1;
        snapshot = undefined;
        request = undefined;
      }
      if (snapshot) return Promise.resolve(snapshot);
      if (request) return request;
      const started = generation;
      request = list()
        .then((next) => {
          if (started === generation) snapshot = next;
          return next;
        })
        .finally(() => {
          if (started === generation) request = undefined;
        });
      return request;
    },
  };
};
