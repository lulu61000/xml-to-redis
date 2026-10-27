'use strict';

const { XMLParser, XMLValidator } = require('fast-xml-parser');

/**
 * Parse the config XML and return the plain data we need:
 *   { subdomains: string[], cookies: { name, host, value }[] }
 *
 * Pure function: no I/O, so it is easy to unit test.
 */
function parseConfig(xml) {
  if (typeof xml !== 'string' || xml.trim() === '') {
    throw new Error('XML input is empty');
  }

  const validation = XMLValidator.validate(xml);
  if (validation !== true) {
    const { msg, line } = validation.err;
    throw new Error(`Invalid XML at line ${line}: ${msg}`);
  }

  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: '@_',
    // Keep values as strings exactly as written (no number/boolean coercion).
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    // Always return arrays for repeatable elements, even when there is only one.
    isArray: (tagName) => tagName === 'subdomain' || tagName === 'cookie',
  });

  const doc = parser.parse(xml);
  if (!('config' in doc)) {
    throw new Error('Root element <config> not found');
  }
  // An empty <config></config> parses to "" rather than an object.
  const config = typeof doc.config === 'object' ? doc.config : {};

  const subdomains = (config.subdomains?.subdomain ?? []).map(textOf);

  const cookies = (config.cookies?.cookie ?? []).map((c, i) => {
    const name = c['@_name'];
    const host = c['@_host'];
    if (!name || !host) {
      throw new Error(`Cookie #${i + 1} is missing a "name" or "host" attribute`);
    }
    return { name, host, value: textOf(c) };
  });

  return { subdomains, cookies };
}

// An element with attributes is parsed as an object ({ '#text': ..., '@_x': ... });
// one without attributes is parsed as a plain string. Normalise both to a string.
function textOf(node) {
  if (node === undefined || node === null) return '';
  if (typeof node === 'object') return String(node['#text'] ?? '');
  return String(node);
}

module.exports = { parseConfig };
