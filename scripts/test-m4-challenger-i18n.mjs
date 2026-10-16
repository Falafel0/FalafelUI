import fs from 'fs';
import path from 'path';

const dir = 'src/lib/locales';
const files = fs.readdirSync(dir).filter(f => f.endsWith('.ts')).sort();

function parseKeys(content) {
  const map = new Map();
  for (const m of content.matchAll(/"([^"]+)":\s*"((?:\\.|[^"\\])*)"/g)) {
    map.set(m[1], m[2]);
  }
  return map;
}

function placeholders(value) {
  const set = new Set();
  for (const m of value.matchAll(/\{([^}]+)\}/g)) set.add(m[1]);
  return set;
}

function sameSet(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

const all = {};
for (const f of files) {
  const content = fs.readFileSync(path.join(dir, f), 'utf8');
  all[f] = parseKeys(content);
}

const en = all['en.ts'];
console.log(`Found ${files.length} locale files.`);

// 1. Verify key counts
let countFailures = 0;
for (const f of files) {
  const sz = all[f].size;
  if (sz !== 4416) {
    console.error(`Count mismatch: ${f} has ${sz} keys (expected 4416)`);
    countFailures++;
  } else {
    console.log(`  ${f}: exactly ${sz} keys`);
  }
}

// 2. Parity check (missing, extra, placeholders)
let parityFailures = 0;
for (const f of files) {
  if (f === 'en.ts') continue;
  const missing = [...en.keys()].filter(k => !all[f].has(k));
  const extra = [...all[f].keys()].filter(k => !en.has(k));
  const placeholderMismatches = [];
  for (const [k, enVal] of en) {
    if (!all[f].has(k)) continue;
    const enPh = placeholders(enVal);
    const locPh = placeholders(all[f].get(k));
    if (!sameSet(enPh, locPh)) {
      placeholderMismatches.push(`${k} (en: {${[...enPh].join(', ')}} vs ${f}: {${[...locPh].join(', ')}})`);
    }
  }

  if (missing.length > 0 || extra.length > 0 || placeholderMismatches.length > 0) {
    console.error(`FAIL: ${f} -> missing: ${missing.length}, extra: ${extra.length}, placeholder mismatches: ${placeholderMismatches.length}`);
    parityFailures++;
  }
}

// 3. Inspect target namespaces
const targetPrefixes = ['canvas.staging.', 'canvas.inspector.', 'generation.inpaint.', 'canvas.layer.'];
const targetKeys = [...en.keys()].filter(k => targetPrefixes.some(p => k.startsWith(p)));
console.log(`\nTarget keys to inspect: ${targetKeys.length}`);
console.log(targetKeys.join('\n'));

let emptyFailures = 0;
for (const f of files) {
  for (const k of targetKeys) {
    const val = all[f].get(k);
    if (!val || val.trim().length === 0) {
      console.error(`FAIL: Empty value for key "${k}" in ${f}`);
      emptyFailures++;
    }
  }
}

// Check sample translations for idiomatic non-empty content
console.log('\n--- SAMPLE INSPECTIONS ---');
const sampleKeys = [
  'canvas.staging.accept_and_inpaint',
  'canvas.staging.apply_to_base',
  'canvas.inspector.inpaint_chain',
  'canvas.inspector.bbox_title',
  'generation.inpaint.inspector_title',
  'generation.inpaint.crop_stitch',
  'canvas.layer.type_raster',
  'canvas.layer.add_regional'
];

for (const k of sampleKeys) {
  console.log(`\nKey: ${k}`);
  for (const f of files) {
    console.log(`  [${f.replace('.ts', '').padEnd(5)}]: ${all[f].get(k)}`);
  }
}

if (countFailures === 0 && parityFailures === 0 && emptyFailures === 0) {
  console.log('\nALL I18N PARITY & TARGET KEY TESTS PASSED!');
  process.exit(0);
} else {
  console.error('\nI18N TESTS FAILED!');
  process.exit(1);
}
