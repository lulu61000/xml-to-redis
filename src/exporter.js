'use strict';

/**
 * Turn parsed config data into the exact Redis key/value pairs required:
 *   "subdomains"            -> JSON array of all subdomains
 *   "cookie:<name>:<host>"  -> cookie value string
 *
 * Pure function: returns an ordered array of [key, value] pairs.
 */
function buildEntries({ subdomains, cookies }) {
  const entries = [['subdomains', JSON.stringify(subdomains)]];
  for (const { name, host, value } of cookies) {
    entries.push([`cookie:${name}:${host}`, value]);
  }
  return entries;
}

/**
 * Write entries to Redis in a single MULTI/EXEC transaction, so a run either
 * saves every key or none of them.
 *
 * `client` only needs `multi()` returning an object with `set()` and `exec()`
 * (the node-redis v4 API), which lets tests pass in a fake client.
 */
async function saveToRedis(client, entries) {
  const tx = client.multi();
  for (const [key, value] of entries) {
    tx.set(key, value);
  }
  await tx.exec();
  return entries.map(([key]) => key);
}

module.exports = { buildEntries, saveToRedis };
