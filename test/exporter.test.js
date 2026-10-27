'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { buildEntries, saveToRedis } = require('../src/exporter');
const { parseArgs, run } = require('../src/cli');

/** Minimal in-memory stand-in for a node-redis v4 client. */
function fakeRedis() {
  const store = new Map();
  const calls = { connect: 0, quit: 0, exec: 0 };
  return {
    store,
    calls,
    on() {},
    async connect() { calls.connect++; },
    async quit() { calls.quit++; },
    multi() {
      const queued = [];
      return {
        set(k, v) { queued.push([k, v]); return this; },
        async exec() { calls.exec++; for (const [k, v] of queued) store.set(k, v); return queued.map(() => 'OK'); },
      };
    },
  };
}

// ---------- buildEntries ----------

test('buildEntries creates "subdomains" as a JSON array and one key per cookie', () => {
  const entries = buildEntries({
    subdomains: ['http://secureline.tools.avast.com', 'http://gf.tools.avast.com'],
    cookies: [{ name: 'dlp-avast', host: 'amazon', value: 'mmm_amz_dlp_777_ppc_m' }],
  });
  assert.deepEqual(entries, [
    ['subdomains', '["http://secureline.tools.avast.com","http://gf.tools.avast.com"]'],
    ['cookie:dlp-avast:amazon', 'mmm_amz_dlp_777_ppc_m'],
  ]);
});

test('buildEntries "subdomains" value round-trips through JSON.parse', () => {
  const subs = ['https://a', 'http://b'];
  const [[, json]] = buildEntries({ subdomains: subs, cookies: [] });
  assert.deepEqual(JSON.parse(json), subs);
});

test('buildEntries still writes an empty JSON array when there are no subdomains', () => {
  assert.deepEqual(buildEntries({ subdomains: [], cookies: [] }), [['subdomains', '[]']]);
});

// ---------- saveToRedis ----------

test('saveToRedis writes every entry in one transaction', async () => {
  const client = fakeRedis();
  const keys = await saveToRedis(client, [['a', '1'], ['b', '2']]);
  assert.deepEqual(keys, ['a', 'b']);
  assert.equal(client.calls.exec, 1);
  assert.equal(client.store.get('a'), '1');
  assert.equal(client.store.get('b'), '2');
});

test('saveToRedis propagates Redis errors', async () => {
  const client = { multi: () => ({ set() {}, exec: async () => { throw new Error('boom'); } }) };
  await assert.rejects(saveToRedis(client, [['k', 'v']]), /boom/);
});

// ---------- CLI ----------

test('parseArgs accepts "-v path" and "path -v"', () => {
  assert.deepEqual(parseArgs(['-v', 'x.xml']), { verbose: true, file: 'x.xml' });
  assert.deepEqual(parseArgs(['x.xml', '-v']), { verbose: true, file: 'x.xml' });
  assert.deepEqual(parseArgs(['x.xml']), { verbose: false, file: 'x.xml' });
});

test('parseArgs rejects missing path, extra paths and unknown flags', () => {
  assert.throws(() => parseArgs([]), /Usage/);
  assert.throws(() => parseArgs(['a.xml', 'b.xml']), /Usage/);
  assert.throws(() => parseArgs(['-x', 'a.xml']), /Unknown option/);
});

test('run with the real config.xml saves 47 keys and prints them with -v', async () => {
  const client = fakeRedis();
  const lines = [];
  const xmlPath = path.join(__dirname, '..', 'config.xml');

  await run(['-v', xmlPath], {
    env: { REDIS_URL: 'redis://test:6379' },
    log: (l) => lines.push(l),
    makeClient: () => client,
  });

  assert.equal(client.store.size, 1 + 46);
  assert.equal(JSON.parse(client.store.get('subdomains')).length, 38);
  assert.equal(client.store.get('cookie:dlp-avast:amazon'), 'mmm_amz_dlp_777_ppc_m');
  assert.equal(client.store.get('cookie:dlp-avg:filehippo'), 'Mmm_fhp_dlp_779_ppc_m');
  assert.ok(lines.includes('cookie:dlp-avast:amazon = mmm_amz_dlp_777_ppc_m'));
  assert.equal(lines.length, 47 + 1); // every key + summary line
  assert.equal(client.calls.quit, 1);
});

test('run without -v prints only the summary line', async () => {
  const client = fakeRedis();
  const lines = [];
  await run([path.join(__dirname, '..', 'config.xml')], {
    env: {}, log: (l) => lines.push(l), makeClient: () => client,
  });
  assert.equal(lines.length, 1);
  assert.match(lines[0], /^Saved 47 keys/);
});

test('run does not touch Redis when the XML is invalid', async () => {
  const tmp = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'x2r-')), 'bad.xml');
  fs.writeFileSync(tmp, '<config><broken></config>');
  const client = fakeRedis();
  await assert.rejects(run([tmp], { env: {}, log: () => {}, makeClient: () => client }), /Invalid XML/);
  assert.equal(client.calls.connect, 0);
});
