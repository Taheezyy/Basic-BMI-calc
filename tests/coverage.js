'use strict';
// White-box coverage report for the calculator logic (<script id="bmi-logic"> in bmi.html).
//
// Usage: npm run coverage   (or: node tests/coverage.js)
//
// Why a custom script: the logic tests load the code with node:vm, so Node's built-in
// --experimental-test-coverage only reports on the test file. This script runs the logic
// tests with V8 coverage switched on, picks out the 'bmi-logic' script, and maps the
// covered byte ranges back to line numbers in bmi.html.

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const HTML = fs.readFileSync(path.join(ROOT, 'bmi.html'), 'utf8');
const OPEN_TAG = '<script id="bmi-logic">';
const start = HTML.indexOf(OPEN_TAG) + OPEN_TAG.length;
const code = HTML.slice(start, HTML.indexOf('</script>', start));
const firstLine = HTML.slice(0, start).split('\n').length; // bmi.html line where the logic starts

// 1. Run the logic tests with V8 coverage written to a temporary folder.
const covDir = fs.mkdtempSync(path.join(os.tmpdir(), 'bmi-cov-'));
const run = spawnSync(process.execPath, ['--test', path.join(__dirname, 'bmi.test.js')], {
  env: Object.assign({}, process.env, { NODE_V8_COVERAGE: covDir }),
  encoding: 'utf8'
});
const summary = (run.stdout.match(/^# (pass|fail) \d+$/gm) || []).join(', ');

// 2. Collect the coverage data for the 'bmi-logic' script (the filename the tests give it).
const scripts = [];
for (const f of fs.readdirSync(covDir)) {
  for (const s of JSON.parse(fs.readFileSync(path.join(covDir, f), 'utf8')).result) {
    if (s.url.endsWith('bmi-logic')) scripts.push(s);
  }
}
fs.rmSync(covDir, { recursive: true, force: true });
if (!scripts.length) {
  console.error('No coverage data found for bmi-logic. Did the tests run? ' + summary);
  process.exit(1);
}

// 3. A character counts as covered if any run executed it. V8 lists ranges outer-first,
//    so a later (inner) range overrides the count of the range around it.
const covered = new Array(code.length).fill(false);
const fnCalls = new Map();
for (const s of scripts) {
  const count = new Array(code.length).fill(null);
  for (const fn of s.functions) {
    for (const r of fn.ranges) {
      for (let i = r.startOffset; i < Math.min(r.endOffset, code.length); i++) count[i] = r.count;
    }
    if (fn.functionName) fnCalls.set(fn.functionName, (fnCalls.get(fn.functionName) || 0) + fn.ranges[0].count);
  }
  count.forEach((c, i) => { if (c) covered[i] = true; });
}

// 4. Report per line: a code line is "uncovered" if any non-space character on it never ran.
const lines = code.split('\n');
let offset = 0, codeLines = 0;
const uncovered = [];
lines.forEach((text, i) => {
  const t = text.trim();
  const isCode = t && !t.startsWith('//') && !t.startsWith('/*') && !t.startsWith('*');
  if (isCode) {
    codeLines++;
    for (let c = 0; c < text.length; c++) {
      if (text[c] !== ' ' && !covered[offset + c]) { uncovered.push([firstLine + i, t]); break; }
    }
  }
  offset += text.length + 1;
});

const functions = [...fnCalls.keys()];
const neverCalled = functions.filter((n) => fnCalls.get(n) === 0);
const pct = (a, b) => (100 * a / b).toFixed(1) + '%';

console.log('Logic tests: ' + summary);
console.log('');
console.log('Coverage of bmi-logic (bmi.html lines ' + firstLine + '-' + (firstLine + lines.length - 1) + ')');
console.log('  Lines fully run:   ' + (codeLines - uncovered.length) + ' / ' + codeLines + '  (' + pct(codeLines - uncovered.length, codeLines) + ')');
console.log('  Functions called:  ' + (functions.length - neverCalled.length) + ' / ' + functions.length + '  (' + pct(functions.length - neverCalled.length, functions.length) + ')');
if (neverCalled.length) console.log('  Never called: ' + neverCalled.join(', '));
console.log('');
if (uncovered.length) {
  console.log('Lines with code that never ran:');
  for (const [n, t] of uncovered) console.log('  bmi.html:' + n + '  ' + t.slice(0, 100));
} else {
  console.log('Every line of the logic ran at least once.');
}
process.exit(run.status === 0 ? 0 : 1);
