/** Reads an entry and refreshes its recency without changing the cache bound. */
export const readLruCache = <Key, Value>(cache: Map<Key, Value>, key: Key): Value | undefined => {
  if (!cache.has(key)) return undefined;
  const value = cache.get(key) as Value;
  cache.delete(key);
  cache.set(key, value);
  return value;
};

/** Stores an entry and evicts the least recently used values over the reviewed limit. */
export const writeLruCache = <Key, Value>(
  cache: Map<Key, Value>,
  key: Key,
  value: Value,
  maxEntries: number,
): void => {
  cache.delete(key);
  cache.set(key, value);
  while (cache.size > Math.max(1, maxEntries)) {
    const oldestKey = cache.keys().next().value as Key | undefined;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }
};
