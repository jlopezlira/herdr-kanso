import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { CLASSES } from './import-proto.mjs';
import { recordsFrom, replaceSource } from './storybook-catalog.mjs';

export function importCoverage(dir, root = '.') {
  const records = readdirSync(dir).filter((file) => file.endsWith('.json')).sort().flatMap((file) => recordsFrom('coverage', file, JSON.parse(readFileSync(join(dir, file), 'utf8'))));
  for (const record of records) record.html = record.html.replace(/\bclass=(['"])(.*?)\1/gs, (_, quote, classes) => `class=${quote}${classes.split(/\s+/).filter(Boolean).map((name) => {
    if (/^kanso-/.test(name)) return name;
    if (!CLASSES[name]) throw new Error(`unmapped coverage class: ${name}`);
    return CLASSES[name];
  }).join(' ')}${quote}`);
  replaceSource('coverage', records, root);
  return records.length;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (!process.argv[2]) throw new Error('usage: node scripts/import-coverage.mjs <coverage-json-dir>');
  console.log(`${importCoverage(process.argv[2])} coverage states imported`);
}
