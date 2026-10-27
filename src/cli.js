#!/usr/bin/env node
'use strict';

const fs = require('fs');
const { createClient } = require('redis');
const { parseConfig } = require('./parser');
const { buildEntries, saveToRedis } = require('./exporter');

const USAGE = 'Usage: export.sh [-v] /path/to/xml';

/**
 * Parse CLI arguments. "-v" may appear before or after the path.
 * Returns { verbose, file } or throws with a usage message.
 */
function parseArgs(argv) {
  let verbose = false;
  const positional = [];
  for (const arg of argv) {
    if (arg === '-v' || arg === '--verbose') verbose = true;
    else if (arg === '-h' || arg === '--help') throw new Error(USAGE);
    else if (arg.startsWith('-')) throw new Error(`Unknown option: ${arg}\n${USAGE}`);
    else positional.push(arg);
  }
  if (positional.length !== 1) throw new Error(USAGE);
  return { verbose, file: positional[0] };
}

async function run(argv, { env = process.env, log = console.log, makeClient = createClient } = {}) {
  const { verbose, file } = parseArgs(argv);

  const xml = fs.readFileSync(file, 'utf8');
  const entries = buildEntries(parseConfig(xml));

  const url = env.REDIS_URL || 'redis://localhost:6379';
  const client = makeClient({ url });
  client.on?.('error', () => {}); // errors surface through the awaited calls below
  await client.connect();
  try {
    await saveToRedis(client, entries);
  } finally {
    await client.quit();
  }

  if (verbose) {
    for (const [key, value] of entries) log(`${key} = ${value}`);
  }
  log(`Saved ${entries.length} keys to Redis (${url}).`);
  return entries;
}

if (require.main === module) {
  run(process.argv.slice(2)).catch((err) => {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  });
}

module.exports = { parseArgs, run };
