export const isAutomaticRecordingName = (name: string): boolean => {
  const stem = name.replace(/ \(\d+\)$/, "");
  return (
    (stem.startsWith("上号-") || stem.startsWith("ShangHao-")) &&
    /\d{4}-\d{2}-\d{2}/.test(stem) &&
    /(?:\d{2}时\d{2}分|\d{2}-\d{2}-\d{2}|\d{2}-\d{2}-\d{2}\.\d{3}Z)$/.test(stem)
  );
};
