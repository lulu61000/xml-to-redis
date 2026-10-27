'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { parseConfig } = require('../src/parser');

test('parses subdomains and cookies from a small document', () => {
  const xml = `
    <config>
      <subdomains>
        <subdomain>http://a.example.com</subdomain>
        <subdomain>https://b.example.com</subdomain>
      </subdomains>
      <cookies>
        <!-- comment is ignored -->
        <cookie name="dlp-avast" host="amazon">mmm_amz_dlp_777_ppc_m</cookie>
      </cookies>
    </config>`;

  assert.deepEqual(parseConfig(xml), {
    subdomains: ['http://a.example.com', 'https://b.example.com'],
    cookies: [{ name: 'dlp-avast', host: 'amazon', value: 'mmm_amz_dlp_777_ppc_m' }],
  });
});

test('a single subdomain / cookie still comes back as an array', () => {
  const xml = `<config>
    <subdomains><subdomain>http://only.one</subdomain></subdomains>
    <cookies><cookie name="n" host="h">v</cookie></cookies>
  </config>`;
  const { subdomains, cookies } = parseConfig(xml);
  assert.deepEqual(subdomains, ['http://only.one']);
  assert.equal(cookies.length, 1);
});

test('values are kept as strings exactly as written (no number coercion, case kept)', () => {
  const xml = `<config><subdomains/>
    <cookies>
      <cookie name="n" host="01net">007</cookie>
      <cookie name="n" host="x">Mmm_Upper</cookie>
    </cookies></config>`;
  const { cookies } = parseConfig(xml);
  assert.equal(cookies[0].host, '01net');
  assert.equal(cookies[0].value, '007');
  assert.equal(cookies[1].value, 'Mmm_Upper');
});

test('missing sections produce empty lists', () => {
  assert.deepEqual(parseConfig('<config></config>'), { subdomains: [], cookies: [] });
});

test('surrounding whitespace and tabs are trimmed', () => {
  const xml = '<config><subdomains>\n\t\t<subdomain>  https://x.net \t</subdomain></subdomains></config>';
  assert.deepEqual(parseConfig(xml).subdomains, ['https://x.net']);
});

test('rejects empty input', () => {
  assert.throws(() => parseConfig('   '), /empty/);
});

test('rejects malformed XML', () => {
  assert.throws(() => parseConfig('<config><subdomains></config>'), /Invalid XML/);
});

test('rejects a document without <config> root', () => {
  assert.throws(() => parseConfig('<other/>'), /<config>/);
});

test('rejects a cookie missing name or host', () => {
  const xml = '<config><cookies><cookie name="only-name">v</cookie></cookies></config>';
  assert.throws(() => parseConfig(xml), /missing/);
});

test('parses the real config.xml shipped with the task', () => {
  const xml = fs.readFileSync(path.join(__dirname, '..', 'config.xml'), 'utf8');
  const { subdomains, cookies } = parseConfig(xml);
  assert.equal(subdomains.length, 38);
  assert.equal(subdomains[0], 'http://secureline.tools.avast.com');
  assert.equal(subdomains.at(-1), 'https://bits.avcdn.net'); // tab-indented line in source
  assert.equal(cookies.length, 46);
});
