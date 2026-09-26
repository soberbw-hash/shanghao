export const compareVersions = (left: string, right: string): number => {
  const parse = (value: string) => {
    const match = /^(\d+)\.(\d+)\.(\d+)$/.exec(value.trim());
    return match ? match.slice(1).map((part) => Number.parseInt(part, 10)) : [];
  };
  const leftParts = parse(left);
  const rightParts = parse(right);
  if (
    leftParts.length < 3 ||
    rightParts.length < 3 ||
    [...leftParts, ...rightParts].some((part) => !Number.isFinite(part))
  ) {
    return Number.NaN;
  }
  for (let index = 0; index < Math.max(leftParts.length, rightParts.length); index += 1) {
    const difference = (leftParts[index] ?? 0) - (rightParts[index] ?? 0);
    if (difference !== 0) return difference;
  }
  return 0;
};
