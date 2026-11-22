'use strict';
// Logic tests for bmi.html (<script id="bmi-logic">), one named test (or group) per AC1-AC16 where logic applies.
// Source of truth: /home/claude/bmi/specs/bmi-calculator.md. Expected teen values come from the CDC CSV, NOT from the app.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.join(__dirname, '..');
const html = fs.readFileSync(path.join(ROOT, 'bmi.html'), 'utf8');
const m = html.match(/<script id="bmi-logic">([\s\S]*?)<\/script>/);
assert.ok(m, 'bmi-logic script block must exist');
const sandbox = { module: { exports: {} } };
vm.createContext(sandbox);
vm.runInContext(m[1], sandbox, { filename: 'bmi-logic' });
const A = sandbox.module.exports;
const { assess, bodyFat, bmi, formatPercentile, switchUnits, cmToFtIn, healthyWeightRange, toMetric } = A;

const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg || ''} expected ${b} ±${tol}, got ${a}`);
const metric = (o) => Object.assign({ units: 'metric' }, o);
const ok = (r) => { assert.ok(!r.error, 'unexpected error ' + JSON.stringify(r)); return r; };

// ---------------- Independent CDC oracle (reads the CSV itself) ----------------
const csv = fs.readFileSync(path.join(ROOT, 'data', 'cdc_bmiagerev_190-241.csv'), 'utf8')
  .replace(/^﻿/, '').trim().split(/\r?\n/);
const head = csv[0].split(',').map((s) => s.trim());
const rows = csv.slice(1).filter((l) => l.trim()).map((l) => {
  const c = l.split(',').map((s) => s.trim());
  const o = {}; head.forEach((h, i) => { o[h] = Number(c[i]); });
  return o;
});
const SEXNUM = { male: 1, female: 2 };
function csvRows(sex) { return rows.filter((r) => r.Sex === SEXNUM[sex]).sort((a, b) => a.Agemos - b.Agemos); }
function oracleLMS(sex, months) {
  const rs = csvRows(sex);
  for (let i = 0; i < rs.length - 1; i++) {
    const lo = rs[i], hi = rs[i + 1];
    if (months >= lo.Agemos && months <= hi.Agemos) {
      const f = (months - lo.Agemos) / (hi.Agemos - lo.Agemos);
      const lerp = (k) => lo[k] + f * (hi[k] - lo[k]);
      return { L: lerp('L'), M: lerp('M'), S: lerp('S'), P5: lerp('P5'), P50: lerp('P50'), P85: lerp('P85'), P95: lerp('P95') };
    }
  }
  throw new Error('CSV has no bracket for ' + months);
}
// High-precision normal CDF (Taylor series for erf; independent of the app's A&S approximation).
function erf(x) {
  let term = x, sum = x;
  for (let n = 1; n < 200; n++) { term *= -x * x / n; sum += term / (2 * n + 1); }
  return 2 / Math.sqrt(Math.PI) * sum;
}
const phi = (z) => 0.5 * (1 + erf(z / Math.SQRT2));
const Z = { 5: -1.6448536269514722, 50: 0, 85: 1.0364333894937898, 95: 1.6448536269514722 };
const bmiAt = (p, z) => p.M * Math.pow(1 + p.L * p.S * z, 1 / p.L);
// Independent oracle for the displayed label (spec: truncated, "<1st" below 1, ">99th" at >= 99).
function oracleLabel(pc) {
  if (pc >= 99) return '>99th'; if (pc < 1) return '<1st';
  const n = Math.floor(pc); const t = n % 100, o = n % 10;
  const suf = (t >= 11 && t <= 13) ? 'th' : o === 1 ? 'st' : o === 2 ? 'nd' : o === 3 ? 'rd' : 'th';
  return n + suf;
}
const pctOf = (p, b) => phi((Math.pow(b / p.M, p.L) - 1) / (p.L * p.S)) * 100;
// Feed a BMI to assess() using a fixed 170 cm height (weight = bmi * 1.7^2, within 30-300 kg).
const r1 = (x) => Number(x.toFixed(1));  // displayed BMI (no exact ties in these inputs)
const teen = (age, sex, b) => assess(metric({ heightCm: 170, weightKg: b * 1.7 * 1.7, age, sex }));

test('oracle self-check: interpolated CSV P5/P50/P85/P95 agree with M*(1+LSz)^(1/L)', () => {
  for (const sex of ['male', 'female']) for (const age of [16, 17, 18, 19]) {
    const p = oracleLMS(sex, age * 12 + 6);
    for (const k of [5, 50, 85, 95]) near(bmiAt(p, Z[k]), p['P' + k], 0.02, `${sex} ${age} P${k}`);
  }
});

// ---------------- AC1-AC3: adult values ----------------
test('AC1 male 30, 180 cm, 80 kg: BMI 24.7, Healthy weight, BF 20.4%, formulas, range 19.2-21.6', () => {
  const r = ok(assess(metric({ heightCm: 180, weightKg: 80, age: 30, sex: 'male' })));
  assert.strictEqual(r.route, 'adult');
  assert.strictEqual(r.bmiRounded.toFixed(1), '24.7');
  assert.strictEqual(r.label, 'Healthy weight');
  near(r.bodyFat.average, 20.4, 0.1, 'average');
  near(r.bodyFat.deurenberg, 20.3, 0.1, 'Deurenberg');
  near(r.bodyFat.gallagher, 19.2, 0.1, 'Gallagher');
  near(r.bodyFat.cunbae, 21.6, 0.1, 'CUN-BAE');
  assert.strictEqual(r.bodyFat.min.toFixed(1) + '-' + r.bodyFat.max.toFixed(1), '19.2-21.6');
  assert.strictEqual(r.olderAdultNote, false);
});
test('AC2 female 45, 165 cm, 68 kg: BMI 25.0 -> Overweight (rounded-value rule), BF 35.1%', () => {
  const r = ok(assess(metric({ heightCm: 165, weightKg: 68, age: 45, sex: 'female' })));
  assert.strictEqual(r.bmiRounded.toFixed(1), '25.0');
  assert.ok(r.bmi < 25, 'unrounded BMI is below 25 (rule is what makes it Overweight)');
  assert.strictEqual(r.label, 'Overweight');
  near(r.bodyFat.average, 35.1, 0.1);
});
test('AC3 male 70, 175 cm, 60 kg: BMI 19.6, Healthy weight, BF 19.9%, 65+ note flag', () => {
  const r = ok(assess(metric({ heightCm: 175, weightKg: 60, age: 70, sex: 'male' })));
  assert.strictEqual(r.bmiRounded.toFixed(1), '19.6');
  assert.strictEqual(r.label, 'Healthy weight');
  near(r.bodyFat.average, 19.9, 0.1);
  assert.strictEqual(r.olderAdultNote, true);
});
test('AC3 (edge) 65+ note threshold: 64 no, 65 yes', () => {
  const f = (age) => ok(assess(metric({ heightCm: 175, weightKg: 70, age, sex: 'female' }))).olderAdultNote;
  assert.strictEqual(f(64), false);
  assert.strictEqual(f(65), true);
});
test('Body-fat formulas use the unrounded BMI and the right sex coding (female differs from male)', () => {
  const a = bodyFat(24.69, 30, 'male'), b = bodyFat(24.69, 30, 'female');
  assert.notStrictEqual(a.cunbae.toFixed(3), b.cunbae.toFixed(3));
  assert.ok(b.average > a.average, 'female fat% should exceed male at same BMI/age');
});

// ---------------- AC4 ----------------
test('AC4 imperial male 30, 5 ft 11 in, 176.4 lb -> BMI 24.6, matches metric 180.34 cm / 80.01 kg within 0.1', () => {
  const imp = ok(assess({ units: 'imperial', heightFt: '5', heightIn: '11', weightLb: '176.4', age: '30', sex: 'male' }));
  assert.strictEqual(imp.bmiRounded.toFixed(1), '24.6');
  const met = ok(assess(metric({ heightCm: 180.34, weightKg: 80.01, age: 30, sex: 'male' })));
  near(imp.bmi, met.bmi, 0.1);
  const mm = toMetric({ units: 'imperial', heightFt: '5', heightIn: '11', weightLb: '176.4' });
  near(mm.heightCm, 180.34, 0.01); near(mm.weightKg, 80.01, 0.01);
});

// ---------------- AC5 ----------------
test('AC5 70 kg/175 cm -> imperial 154.3 lb, 5 ft 8.9 in; back -> 70.0 kg, 175.0 cm', () => {
  const imp = switchUnits({ heightCm: '175', weightKg: '70' }, 'imperial');
  assert.strictEqual(imp.weightLb, '154.3');
  assert.strictEqual(imp.heightFt, '5');
  near(Number(imp.heightIn), 8.9, 0.1);
  const back = switchUnits(imp, 'metric');
  near(Number(back.weightKg), 70, 0.1); near(Number(back.heightCm), 175, 0.1);
});
test('AC5 (edge) blank stays blank; partial values converted, not cleared', () => {
  const i = switchUnits({ heightCm: '', weightKg: '70' }, 'imperial');
  assert.strictEqual(i.heightFt, ''); assert.strictEqual(i.heightIn, ''); assert.strictEqual(i.weightLb, '154.3');
  const e = switchUnits({ heightCm: '', weightKg: '' }, 'imperial');
  assert.strictEqual(e.weightLb, '');
});
test('switchUnits carry: 182.87 cm (71.99 in) -> 6 ft 0.0 in, never 5 ft 12.0 in', () => {
  const i = switchUnits({ heightCm: '182.87', weightKg: '' }, 'imperial');
  assert.strictEqual(i.heightFt, '6'); assert.strictEqual(i.heightIn, '0.0');
  const c = cmToFtIn(182.87); assert.strictEqual(c.ft, 6); assert.strictEqual(c.inches, 0);
  for (let cm = 100; cm <= 250; cm += 0.01) {
    const x = cmToFtIn(cm);
    if (x.inches >= 12 || x.inches < 0) assert.fail('inches out of range at ' + cm + ': ' + JSON.stringify(x));
  }
});

// ---------------- AC6 ----------------
test('AC6 embedded CDC_LMS rows equal the official CSV values exactly (no missing, no extra, no drift)', () => {
  for (const sex of ['male', 'female']) {
    const embedded = A.CDC_LMS[sex];
    assert.ok(embedded.length >= 8, sex + ' has rows');
    const covered = new Set();
    for (const row of embedded) {
      const c = csvRows(sex).find((r) => r.Agemos === row[0]);
      assert.ok(c, `${sex} Agemos ${row[0]} not in CSV`);
      assert.strictEqual(row[1], c.L, `${sex} ${row[0]} L`);
      assert.strictEqual(row[2], c.M, `${sex} ${row[0]} M`);
      assert.strictEqual(row[3], c.S, `${sex} ${row[0]} S`);
      covered.add(row[0]);
    }
    for (const age of [16, 17, 18, 19]) {
      assert.ok(covered.has(age * 12 + 5.5) && covered.has(age * 12 + 6.5), `${sex} age ${age} bracket rows embedded`);
    }
  }
});
for (const sex of ['male', 'female']) for (const age of [16, 17, 18, 19]) {
  test(`AC6 teen ${sex} ${age}: percentile within 1 of CDC oracle at ~P5/P50/P85/P95; category per CDC thresholds; no body fat`, () => {
    const p = oracleLMS(sex, age * 12 + 6);
    const expectCat = { 5: 'Healthy weight', 50: 'Healthy weight', 85: 'Overweight', 95: 'Obesity' };
    const below = { 5: 'Underweight', 50: 'Healthy weight', 85: 'Healthy weight', 95: 'Overweight' };
    for (const k of [5, 50, 85, 95]) {
      const b = bmiAt(p, Z[k]);
      // exactly at the percentile
      const r = ok(teen(age, sex, b));
      assert.strictEqual(r.route, 'teen');
      near(r.percentile, k, 1, `${sex}${age} P${k} percentile`);
      near(r.percentile, pctOf(p, r1(b)), 0.05, 'matches oracle percentile of the displayed BMI');
      assert.strictEqual(r.percentileLabel, oracleLabel(pctOf(p, r1(b))), 'label = truncated oracle percentile');
      assert.strictEqual(r.bodyFat, null, 'no body fat for teens');
      assert.ok(!r.healthyRange, 'no healthy range for teens');
      near(r.p95, bmiAt(p, Z[95]), 0.001, 'p95');
      // slightly above / below the cut points (+-0.8%; percentile uses the 1-dp displayed BMI)
      const up = ok(teen(age, sex, b * 1.008)), dn = ok(teen(age, sex, b * 0.992));
      if (k !== 50) {
        assert.strictEqual(up.label, expectCat[k], `${sex}${age} just above P${k}`);
        assert.strictEqual(dn.label, below[k], `${sex}${age} just below P${k}`);
      } else {
        assert.strictEqual(up.label, 'Healthy weight'); assert.strictEqual(dn.label, 'Healthy weight');
      }
    }
    // far extremes
    assert.strictEqual(ok(teen(age, sex, bmiAt(p, Z[5]) * 0.8)).label, 'Underweight');
    near(ok(teen(age, sex, bmiAt(p, Z[85]))).percentile, 85, 1);
  });
}
test('AC6 percentile label is the TRUNCATED oracle percentile of the displayed BMI, with ordinal (sweep)', () => {
  for (const sex of ['male', 'female']) for (const age of [16, 17, 18, 19]) {
    const p = oracleLMS(sex, age * 12 + 6);
    for (let b = 13; b <= 45; b += 0.37) {
      const r = ok(teen(age, sex, b));
      assert.strictEqual(r.percentileLabel, oracleLabel(pctOf(p, r.bmiRounded)), `${sex}${age} BMI ${r.bmiRounded}`);
    }
  }
});

// contract gap closed (review 2026-11-22): category label asserted at EVERY 0.1 displayed-BMI step 13-45, all 8 combos, vs CSV oracle.
test('AC6 (sweep) category label at every 0.1 BMI step 13.0-45.0, 8 age/sex combos, equals CSV-oracle category of the displayed BMI', () => {
  let checked = 0, skipped = 0;
  for (const sex of ['male', 'female']) for (const age of [16, 17, 18, 19]) {
    const p = oracleLMS(sex, age * 12 + 6);
    const p95 = bmiAt(p, Z[95]);
    for (let i = 130; i <= 450; i++) {
      const b = i / 10;
      const r = ok(teen(age, sex, b));
      assert.strictEqual(r.bmiRounded, b, `displayed BMI for input ${b}`);
      const pc = pctOf(p, r.bmiRounded);
      // skip only cut points within 1e-4 of a percentile threshold (app uses a 1.5e-7 erf approximation)
      if ([5, 85, 95].some((t) => Math.abs(pc - t) < 1e-4)) { skipped++; continue; }
      const want = (r.bmiRounded >= 35 || r.bmiRounded >= 1.2 * p95) ? 'Obesity (severe)'
        : pc < 5 ? 'Underweight' : pc < 85 ? 'Healthy weight' : pc < 95 ? 'Overweight' : 'Obesity';
      assert.strictEqual(r.label, want, `${sex}${age} displayed BMI ${b} (oracle pct ${pc.toFixed(3)}, 1.2*P95 ${(1.2 * p95).toFixed(3)})`);
      checked++;
    }
  }
  assert.ok(checked > 2500, 'checked ' + checked + ' skipped ' + skipped);
});

// ---------------- AC7 ----------------
test('AC7 trigger 1: teen BMI >= 35 shows "Obesity (severe)" for all ages/sexes; 34.0 does not (unless > 1.2*p95)', () => {
  for (const sex of ['male', 'female']) for (const age of [16, 17, 18, 19]) {
    const r = ok(teen(age, sex, 35));
    assert.strictEqual(r.label, 'Obesity (severe)', `${sex}${age} @35`);
    assert.strictEqual(ok(teen(age, sex, 40)).label, 'Obesity (severe)');
  }
});
test('AC7 trigger 2: BMI >= 120% of P95 is reachable below 35 for EXACTLY male 16 and male 17; label flips at the threshold', () => {
  const reach = [];
  for (const sex of ['male', 'female']) for (const age of [16, 17, 18, 19]) {
    const p = oracleLMS(sex, age * 12 + 6);
    const thr = 1.2 * bmiAt(p, Z[95]);
    // lowest displayed (0.1-step) BMI at/above the threshold; "reachable" = that BMI is still < 35
    const firstShown = Math.ceil(thr * 10 - 1e-9) / 10;
    if (firstShown < 35) {
      reach.push(`${sex} ${age}`);
      const up = ok(teen(age, sex, firstShown));
      assert.strictEqual(up.label, 'Obesity (severe)', `${sex}${age} at displayed ${firstShown} (1.2*P95=${thr.toFixed(3)})`);
      const dn = ok(teen(age, sex, firstShown - 0.1));
      assert.strictEqual(dn.label, 'Obesity', `${sex}${age} at displayed ${(firstShown - 0.1).toFixed(1)}`);
    } else {
      assert.strictEqual(ok(teen(age, sex, 34.9)).label, 'Obesity', `${sex}${age} 34.9`);
      assert.strictEqual(ok(teen(age, sex, 35)).label, 'Obesity (severe)', `${sex}${age} 35`);
    }
  }
  // test defect fixed (review 2026-11-22): was the vacuous `reachable >= 0`.
  assert.deepStrictEqual(reach, ['male 16', 'male 17']);
});

// ---------------- AC8 ----------------
test('AC8 age 19 -> teen route; age 20 -> adult route (same body)', () => {
  const t = ok(assess(metric({ heightCm: 175, weightKg: 70, age: 19, sex: 'male' })));
  const a = ok(assess(metric({ heightCm: 175, weightKg: 70, age: 20, sex: 'male' })));
  assert.strictEqual(t.route, 'teen'); assert.strictEqual(t.bodyFat, null); assert.ok(t.percentileLabel);
  assert.strictEqual(a.route, 'adult'); assert.ok(a.bodyFat && a.healthyRange);
  assert.ok(a.percentile === undefined || a.percentile === null);
});

// ---------------- AC9 ----------------
const base = { units: 'metric', heightCm: 175, weightKg: 70, age: 30, sex: 'male' };
const bad = (over, code, field) => {
  const r = assess(Object.assign({}, base, over));
  assert.strictEqual(r.error, code, JSON.stringify(over) + ' -> ' + JSON.stringify(r));
  assert.strictEqual(r.field, field);
  assert.ok(Array.isArray(r.errors) && r.errors.length >= 1);
  assert.strictEqual(r.bmi, undefined, 'no result data with an error');
  assert.strictEqual(r.category, undefined);
};
test('AC9 logic rejects age 15, 101, 30.5 (number and string)', () => {
  bad({ age: 15 }, 'AGE_OUT_OF_RANGE', 'age'); bad({ age: '15' }, 'AGE_OUT_OF_RANGE', 'age');
  bad({ age: 101 }, 'AGE_OUT_OF_RANGE', 'age'); bad({ age: '101' }, 'AGE_OUT_OF_RANGE', 'age');
  bad({ age: 30.5 }, 'AGE_NOT_WHOLE', 'age'); bad({ age: '30.5' }, 'AGE_NOT_WHOLE', 'age');
  bad({ age: 0 }, 'AGE_OUT_OF_RANGE', 'age'); bad({ age: -20 }, 'AGE_OUT_OF_RANGE', 'age');
});
test('AC9 logic rejects height 90 / 260 cm; weight 25 / 400 kg', () => {
  bad({ heightCm: 90 }, 'HEIGHT_OUT_OF_RANGE', 'height'); bad({ heightCm: '260' }, 'HEIGHT_OUT_OF_RANGE', 'height');
  bad({ heightCm: 99.9 }, 'HEIGHT_OUT_OF_RANGE', 'height'); bad({ heightCm: 250.1 }, 'HEIGHT_OUT_OF_RANGE', 'height');
  bad({ weightKg: 25 }, 'WEIGHT_OUT_OF_RANGE', 'weight'); bad({ weightKg: '400' }, 'WEIGHT_OUT_OF_RANGE', 'weight');
  bad({ weightKg: 29.9 }, 'WEIGHT_OUT_OF_RANGE', 'weight'); bad({ weightKg: 300.1 }, 'WEIGHT_OUT_OF_RANGE', 'weight');
});
test('AC9 logic rejects empty / non-numeric / undefined fields and missing sex', () => {
  bad({ age: '' }, 'MISSING_VALUE', 'age'); bad({ heightCm: '' }, 'MISSING_VALUE', 'height');
  bad({ weightKg: '' }, 'MISSING_VALUE', 'weight'); bad({ weightKg: '   ' }, 'MISSING_VALUE', 'weight');
  bad({ age: undefined }, 'MISSING_VALUE', 'age');
  // contract change 2026-11-22 review: non-blank non-numeric text is NOT_A_NUMBER (was MISSING_VALUE); see AC25 tests.
  bad({ heightCm: 'abc' }, 'NOT_A_NUMBER', 'height');
  // numeric NaN: spec does not say NOT_A_NUMBER vs MISSING_VALUE; only assert it is rejected on the weight field.
  { const r = assess(Object.assign({}, base, { weightKg: NaN })); assert.ok(r.error && r.field === 'weight', JSON.stringify(r)); }
  bad({ sex: '' }, 'SEX_REQUIRED', 'sex'); bad({ sex: undefined }, 'SEX_REQUIRED', 'sex'); bad({ sex: 'other' }, 'SEX_REQUIRED', 'sex');
});
test('AC9 all-empty input reports every field in form order (height, weight, age, sex)', () => {
  const r = assess({ units: 'metric', heightCm: '', weightKg: '', age: '', sex: '' });
  assert.deepStrictEqual(Array.from(r.errors, (e) => e.field), ['height', 'weight', 'age', 'sex']);
  assert.strictEqual(r.field, 'height');
  const r2 = assess({ units: 'imperial', heightFt: '', heightIn: '', weightLb: '', age: '', sex: '' });
  assert.deepStrictEqual(Array.from(r2.errors, (e) => e.field), ['height', 'weight', 'age', 'sex']);
});
test('AC9 limits are inclusive: age 16/100; 100 cm and 250 cm; 30 kg and 300 kg (paired with plausible partners)', () => {
  ok(assess(Object.assign({}, base, { age: 16 }))); ok(assess(Object.assign({}, base, { age: 100 })));
  ok(assess(Object.assign({}, base, { heightCm: 100, weightKg: 30 })));   // BMI 30.0
  ok(assess(Object.assign({}, base, { heightCm: 250, weightKg: 70 })));   // BMI 11.2
  ok(assess(Object.assign({}, base, { heightCm: 250, weightKg: 300 })));  // BMI 48.0
  ok(assess(Object.assign({}, base, { heightCm: 100, weightKg: 70 })));   // BMI 70.0
  ok(assess(Object.assign({}, base, { heightCm: 170, weightKg: 30 })));   // BMI 10.4
  ok(assess(Object.assign({}, base, { heightCm: 200, weightKg: 300 })));  // BMI 75.0
});
const imp = (o) => assess(Object.assign({ units: 'imperial', heightFt: '5', heightIn: '8', weightLb: '150', age: '30', sex: 'male' }, o));
test('AC9 imperial: inches 12 and -1 rejected; 11.9 accepted; blank inches counts as 0', () => {
  assert.strictEqual(imp({ heightIn: '12' }).error, 'HEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightIn: '-1' }).error, 'HEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightIn: '12.0' }).error, 'HEIGHT_OUT_OF_RANGE');
  ok(imp({ heightIn: '11.9' })); ok(imp({ heightIn: '11.99' })); ok(imp({ heightIn: '0' }));
  ok(imp({ heightIn: '' }));
  assert.strictEqual(imp({ heightFt: '' }).error, 'MISSING_VALUE');
});
test('AC9 imperial: other out-of-range values still rejected (paired with plausible partners)', () => {
  assert.strictEqual(imp({ weightLb: '700' }).error, 'WEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ weightLb: '60' }).error, 'WEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightFt: '3', heightIn: '0' }).error, 'HEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightFt: '9', heightIn: '0' }).error, 'HEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightFt: '-5' }).error, 'HEIGHT_OUT_OF_RANGE');
});

// ---------------- AC10 ----------------
test('AC10 category boundaries on rounded BMI (200 cm => weight = 4 * BMI)', () => {
  const lab = (b) => ok(assess(metric({ heightCm: 200, weightKg: b * 4, age: 40, sex: 'female' }))).label;
  assert.strictEqual(lab(18.4), 'Underweight');
  assert.strictEqual(lab(18.5), 'Healthy weight');
  assert.strictEqual(lab(24.9), 'Healthy weight');
  assert.strictEqual(lab(25.0), 'Overweight');
  assert.strictEqual(lab(29.9), 'Overweight');
  assert.strictEqual(lab(30.0), 'Obesity');
});
test('AC10 (edge) rounding decides: 18.46 -> 18.5 Healthy; 18.44 -> Underweight; 24.96 -> Overweight; 29.96 -> Obesity; 24.94 Healthy', () => {
  const lab = (b) => ok(assess(metric({ heightCm: 200, weightKg: b * 4, age: 40, sex: 'male' }))).label;
  assert.strictEqual(lab(18.46), 'Healthy weight'); assert.strictEqual(lab(18.44), 'Underweight');
  assert.strictEqual(lab(24.96), 'Overweight'); assert.strictEqual(lab(24.94), 'Healthy weight');
  assert.strictEqual(lab(29.96), 'Obesity'); assert.strictEqual(lab(29.94), 'Overweight');
});
test('AC10 (edge) adult obesity has no severe tier (BMI 45 at age 20 is "Obesity")', () => {
  assert.strictEqual(ok(assess(metric({ heightCm: 200, weightKg: 180, age: 20, sex: 'male' }))).label, 'Obesity');
});

// ---------------- AC11 ----------------
// contract change 2026-11-22 review: healthy range follows the rounded-BMI rule: 59.8-80.8 kg at 180 cm (was raw BMI: 59.9-80.7).
test('AC11 healthy weight range for 180 cm = 59.8-80.8 kg (adults only)  [contract change 2026-11-22 review]', () => {
  const r = ok(assess(metric({ heightCm: 180, weightKg: 75, age: 30, sex: 'female' })));
  assert.strictEqual(r.healthyRange.minKg.toFixed(1) + '-' + r.healthyRange.maxKg.toFixed(1), '59.8-80.8');
  const h = healthyWeightRange(1.8);
  assert.strictEqual(h.minKg.toFixed(1), '59.8'); assert.strictEqual(h.maxKg.toFixed(1), '80.8');
  assert.ok(!ok(assess(metric({ heightCm: 180, weightKg: 75, age: 19, sex: 'female' }))).healthyRange);
});
test('AC11 edge categories at 180 cm, adult: 59.7 Underweight, 59.8 Healthy, 80.8 Healthy, 80.9 Overweight (both sexes)', () => {
  for (const sex of ['male', 'female']) {
    const lab = (w) => ok(assess(metric({ heightCm: 180, weightKg: w, age: 30, sex }))).label;
    assert.strictEqual(lab(59.7), 'Underweight', sex + ' 59.7');
    assert.strictEqual(lab(59.8), 'Healthy weight', sex + ' 59.8');
    assert.strictEqual(lab(80.8), 'Healthy weight', sex + ' 80.8');
    assert.strictEqual(lab(80.9), 'Overweight', sex + ' 80.9');
  }
});
test('AC11 range endpoints are whole 0.1 kg steps (lightest/heaviest weight in 0.1 kg steps; heights 130-250 cm)', () => {
  for (let cm = 130; cm <= 250; cm += 5) {
    const h = healthyWeightRange(cm / 100);
    for (const k of ['minKg', 'maxKg']) assert.ok(Math.abs(h[k] * 10 - Math.round(h[k] * 10)) < 1e-6, `${cm} cm ${k}=${h[k]} not a 0.1 step`);
  }
});
test('AC11 range agrees with the category rule: lightest/heaviest endpoint Healthy, 0.1 kg outside is Underweight/Overweight (heights 130-250 cm)', () => {
  for (let cm = 130; cm <= 250; cm += 5) {
    const h = healthyWeightRange(cm / 100);
    const lab = (w) => ok(assess(metric({ heightCm: cm, weightKg: Number(w.toFixed(1)), age: 30, sex: 'male' }))).label;
    const lo = Number(h.minKg.toFixed(1)), hi = Number(h.maxKg.toFixed(1));
    assert.strictEqual(lab(lo), 'Healthy weight', `${cm} cm lightest ${lo}`);
    assert.strictEqual(lab(hi), 'Healthy weight', `${cm} cm heaviest ${hi}`);
    assert.strictEqual(lab(lo - 0.1), 'Underweight', `${cm} cm lightest - 0.1`);
    assert.strictEqual(lab(hi + 0.1), 'Overweight', `${cm} cm heaviest + 0.1`);
  }
});

// ---------------- AC12 / AC13 / AC14 / AC15 / AC16: static-source checks (UI behaviour is in browser_test.py) ----------------
test('AC12 disclaimer text present in static markup outside the result container', () => {
  assert.ok(html.includes('A screening tool, not medical advice.'));
  const before = html.indexOf('A screening tool, not medical advice.');
  assert.ok(before < html.indexOf('id="bmi-result"'), 'disclaimer is outside/above result region so it survives results');
});
test('AC15 static markup: result region has aria-live; every input has a label[for]', () => {
  assert.match(html, /id="bmi-result"[^>]*aria-live="(polite|assertive)"/);
  for (const id of ['height-cm', 'height-ft', 'height-in', 'weight', 'age']) {
    assert.match(html, new RegExp('<label[^>]*for="' + id + '"'), 'label for ' + id);
  }
});
test('AC16 static check: no external URLs, links, scripts, imports or fetch/XHR in the single file', () => {
  assert.doesNotMatch(html, /\b(src|href)\s*=\s*["']?(https?:)?\/\//i);
  assert.doesNotMatch(html, /url\(\s*["']?https?:/i);
  assert.doesNotMatch(html, /@import|\bfetch\s*\(|XMLHttpRequest|sendBeacon|WebSocket/);
});

// ---------------- formatPercentile ----------------
test('formatPercentile: truncated ordinals; "<1st" below 1; ">99th" at >= 99', () => {
  const exp = { 1: '1st', 2: '2nd', 3: '3rd', 4: '4th', 11: '11th', 12: '12th', 13: '13th', 21: '21st', 22: '22nd', 23: '23rd', 50: '50th', 85: '85th', 95: '95th', 98: '98th' };
  for (const [n, s2] of Object.entries(exp)) assert.strictEqual(formatPercentile(Number(n)), s2);
  assert.strictEqual(formatPercentile(0.3), '<1st'); assert.strictEqual(formatPercentile(0), '<1st'); assert.strictEqual(formatPercentile(0.99), '<1st');
  assert.strictEqual(formatPercentile(1.0), '1st');
  assert.strictEqual(formatPercentile(99), '>99th'); assert.strictEqual(formatPercentile(99.7), '>99th'); assert.strictEqual(formatPercentile(100), '>99th');
  // truncation, never rounding up into the next label
  assert.strictEqual(formatPercentile(84.99), '84th'); assert.strictEqual(formatPercentile(94.9), '94th');
  assert.strictEqual(formatPercentile(4.99), '4th'); assert.strictEqual(formatPercentile(98.99), '98th');
  assert.strictEqual(formatPercentile(21.9), '21st'); assert.strictEqual(formatPercentile(12.9), '12th');
});

// ---------------- AC17 ----------------
// Independent (unclamped) formulas, copied from the spec text.
const rawBF = (b, age, sex) => {
  const S = sex === 'male' ? 1 : 0, F = 1 - S;
  return {
    deurenberg: 1.2 * b + 0.23 * age - 10.8 * S - 5.4,
    gallagher: 64.5 - 848 / b + 0.079 * age - 16.4 * S + 0.05 * S * age + 39.0 * S / b,
    cunbae: -44.988 + 0.503 * age + 10.689 * F + 3.172 * b - 0.026 * b * b + 0.181 * b * F - 0.02 * b * age - 0.005 * b * b * F + 0.00021 * b * b * age
  };
};
const within = (x) => x >= 0 && x <= 100;
function bfChecks(r, label) {
  const bf = r.bodyFat;
  for (const k of ['deurenberg', 'gallagher', 'cunbae', 'average', 'min', 'max']) assert.ok(within(bf[k]), `${label} ${k}=${bf[k]} outside 0-100`);
  near(bf.average, (bf.deurenberg + bf.gallagher + bf.cunbae) / 3, 1e-9, label + ' average of clamped values');
  assert.strictEqual(bf.min, Math.min(bf.deurenberg, bf.gallagher, bf.cunbae));
  assert.strictEqual(bf.max, Math.max(bf.deurenberg, bf.gallagher, bf.cunbae));
  for (const k of ['average', 'min', 'max']) { const t = bf[k].toFixed(1); assert.ok(Number(t) >= 0 && Number(t) <= 100, label + ' displayed ' + t); }
}
test('AC17 male 20, 200 cm, 40 kg (BMI 10.0): every formula, average and range within 0-100% (clamp is necessary)', () => {
  const r = ok(assess(metric({ heightCm: 200, weightKg: 40, age: 20, sex: 'male' })));
  assert.strictEqual(r.bmiRounded.toFixed(1), '10.0');
  const raw = rawBF(r.bmi, 20, 'male');
  assert.ok(Math.min(raw.deurenberg, raw.gallagher, raw.cunbae) < 0, 'precondition: unclamped value is negative: ' + JSON.stringify(raw));
  bfChecks(r, 'male20');
});
test('AC17 female 100, 150 cm, 180 kg (BMI 80.0): every formula, average and range within 0-100% (clamp is necessary)', () => {
  const r = ok(assess(metric({ heightCm: 150, weightKg: 180, age: 100, sex: 'female' })));
  assert.strictEqual(r.bmiRounded.toFixed(1), '80.0');
  const raw = rawBF(r.bmi, 100, 'female');
  assert.ok(Math.max(raw.deurenberg, raw.gallagher, raw.cunbae) > 100, 'precondition: unclamped value exceeds 100: ' + JSON.stringify(raw));
  bfChecks(r, 'female100');
});
test('AC17 (sweep) valid grid: all adult ages x sexes x BMI 10..80 stay within 0-100%; in-range values unchanged by clamping', () => {
  for (const sex of ['male', 'female']) for (const age of [20, 25, 40, 65, 100]) for (let b = 10; b <= 80; b += 2.5) {
    const h = b < 14 ? 200 : 150;  // keep weight inside 30-300 kg across BMI 10..80
    const r = ok(assess(metric({ heightCm: h, weightKg: b * (h / 100) ** 2, age, sex })));
    bfChecks(r, `${sex}${age} BMI${b}`);
    const raw = rawBF(r.bmi, age, sex);
    for (const k of ['deurenberg', 'gallagher', 'cunbae']) {
      if (raw[k] >= 0 && raw[k] <= 100) near(r.bodyFat[k], raw[k], 1e-9, 'unclamped passthrough ' + k);
    }
  }
});

// ---------------- AC18 ----------------
const MSG_CODE = 'BMI_IMPLAUSIBLE';
test('AC18 BMI < 10 / > 80 rejected as BMI_IMPLAUSIBLE (field height), no result data: 250 cm/30 kg, 100 cm/300 kg', () => {
  for (const [h, w] of [[250, 30], [100, 300], [250, 62], [100, 80.1], [200, 30]]) {
    const r = assess(metric({ heightCm: h, weightKg: w, age: 30, sex: 'male' }));
    assert.strictEqual(r.error, MSG_CODE, `${h}/${w} -> ${JSON.stringify(r)}`);
    assert.strictEqual(r.field, 'height');
    assert.strictEqual(r.bmi, undefined); assert.strictEqual(r.category, undefined);
  }
});
test('AC18 BMI exactly 10.0 and 80.0 accepted (several height/weight pairs)', () => {
  for (const [h, w, want] of [[200, 40, '10.0'], [250, 62.5, '10.0'], [150, 180, '80.0'], [100, 80, '80.0'], [200, 300, '75.0']]) {
    assert.strictEqual(ok(assess(metric({ heightCm: h, weightKg: w, age: 30, sex: 'female' }))).bmiRounded.toFixed(1), want);
  }
});
test('AC18 check uses the displayed (rounded) BMI: 9.96 -> 10.0 accepted, 9.94 -> 9.9 rejected; 80.04 accepted, 80.06 rejected', () => {
  const f = (h, w) => assess(metric({ heightCm: h, weightKg: w, age: 30, sex: 'male' }));
  ok(f(200, 9.96 * 4)); assert.strictEqual(f(200, 9.94 * 4).error, MSG_CODE);
  ok(f(150, 80.04 * 2.25)); assert.strictEqual(f(150, 80.06 * 2.25).error, MSG_CODE);
});
test('AC18 combination check only when height and weight are individually valid; other errors still reported', () => {
  let r = assess(metric({ heightCm: 90, weightKg: 300, age: 30, sex: 'male' }));
  assert.deepStrictEqual(Array.from(r.errors, (e) => e.error), ['HEIGHT_OUT_OF_RANGE']);
  r = assess(metric({ heightCm: 260, weightKg: 30, age: 30, sex: 'male' }));
  assert.deepStrictEqual(Array.from(r.errors, (e) => e.error), ['HEIGHT_OUT_OF_RANGE']);
  r = assess(metric({ heightCm: 250, weightKg: 400, age: 30, sex: 'male' }));
  assert.deepStrictEqual(Array.from(r.errors, (e) => e.error), ['WEIGHT_OUT_OF_RANGE']);
  r = assess(metric({ heightCm: 250, weightKg: 30, age: 15, sex: '' }));
  assert.deepStrictEqual(Array.from(r.errors, (e) => e.error + ':' + e.field), ['BMI_IMPLAUSIBLE:height', 'AGE_OUT_OF_RANGE:age', 'SEX_REQUIRED:sex']);
});
// contract change 2026-11-22 review: imperial limits derive from metric (100-250 cm, 30-300 kg, at 0.1 precision).
// Old pairs 3 ft 3 in/660 lb (BMI_IMPLAUSIBLE), 8 ft 2 in/66 lb (BMI_IMPLAUSIBLE) and 3 ft 3 in/66 lb (accepted) now fail the individual range checks first.
test('AC18 imperial combinations: 3 ft 4 in + 660 lb and 8 ft 2 in + 67 lb rejected as BMI_IMPLAUSIBLE; 3 ft 4 in + 67 lb accepted  [contract change 2026-11-22 review]', () => {
  const g = (ft, inch, lb) => assess({ units: 'imperial', heightFt: ft, heightIn: inch, weightLb: lb, age: '30', sex: 'male' });
  assert.strictEqual(g('3', '4', '660').error, MSG_CODE);
  assert.strictEqual(g('8', '2', '67').error, MSG_CODE);
  ok(g('3', '4', '67'));
});
// gap closed (review 2026-11-22): imperial BMI 10.0 / 80.0 boundary pairs accepted, 9.9 / 80.1 neighbours rejected.
test('AC18 imperial BMI boundaries: pairs giving displayed 10.0 and 80.0 accepted; one 0.1 lb step beyond (9.9 / 80.1) rejected as BMI_IMPLAUSIBLE', () => {
  const LB = 0.45359237, IN = 0.0254;
  const orBmi = (ft, inch, lb) => (lb * LB) / (((ft * 12 + inch) * IN) ** 2);
  const g = (ft, inch, lb) => assess({ units: 'imperial', heightFt: String(ft), heightIn: String(inch), weightLb: lb.toFixed(1), age: '30', sex: 'female' });
  let pairs = 0;
  for (const [ft, inch] of [[6, 0], [7, 0], [8, 2], [6, 3]]) {          // low edge: heights tall enough for BMI 10 at >= 30 kg
    let lb = 67; while (Math.round(orBmi(ft, inch, lb) * 10) / 10 < 10) lb = Math.round((lb + 0.1) * 10) / 10;
    const raw = orBmi(ft, inch, lb); if (Math.abs(raw * 10 - Math.floor(raw * 10) - 0.5) < 1e-6) continue;
    const r = ok(g(ft, inch, lb)); assert.strictEqual(r.bmiRounded, 10, `${ft}'${inch}" ${lb} lb`);
    const below = g(ft, inch, Math.round((lb - 0.1) * 10) / 10);
    assert.strictEqual(below.error, MSG_CODE, `${ft}'${inch}" ${(lb - 0.1).toFixed(1)} lb -> ${JSON.stringify(below)}`);
    pairs++;
  }
  for (const [ft, inch] of [[5, 0], [5, 10], [6, 4], [4, 6]]) {          // high edge: heights short enough for BMI 80 at <= 300 kg
    let lb = 661; while (Math.round(orBmi(ft, inch, lb) * 10) / 10 > 80) lb = Math.round((lb - 0.1) * 10) / 10;
    const raw = orBmi(ft, inch, lb); if (Math.abs(raw * 10 - Math.floor(raw * 10) - 0.5) < 1e-6) continue;
    const r = ok(g(ft, inch, lb)); assert.strictEqual(r.bmiRounded, 80, `${ft}'${inch}" ${lb} lb`);
    const above = g(ft, inch, Math.round((lb + 0.1) * 10) / 10);
    assert.strictEqual(above.error, MSG_CODE, `${ft}'${inch}" ${(lb + 0.1).toFixed(1)} lb -> ${JSON.stringify(above)}`);
    pairs++;
  }
  assert.ok(pairs >= 6, 'enough boundary pairs exercised: ' + pairs);
});

// ---------------- AC19 ----------------
test('AC19 LIMITS export: metric/age/BMI limits (imperial limits are derived from metric, no separate numbers)  [contract change 2026-11-22 review]', () => {
  const L = A.LIMITS;
  // contract change 2026-11-22 review: removed the assertion LIMITS.imperial.heightIn/weightLb = [39,98,66,660]; spec says metric limits are the only range limits.
  assert.deepStrictEqual([L.age.min, L.age.max], [16, 100]);
  assert.deepStrictEqual([L.metric.heightCm.min, L.metric.heightCm.max, L.metric.weightKg.min, L.metric.weightKg.max], [100, 250, 30, 300]);
  assert.deepStrictEqual([L.bmi.min, L.bmi.max], [10, 80]);
});
test('AC19 "5.11" ft rejected as HEIGHT_FEET_NOT_WHOLE (also 5.5 and numeric 5.5)', () => {
  for (const ft of ['5.11', '5.5', 5.5, '3.2']) {
    const r = imp({ heightFt: ft, heightIn: '' });
    assert.strictEqual(r.error, 'HEIGHT_FEET_NOT_WHOLE', String(ft)); assert.strictEqual(r.field, 'height');
  }
  assert.strictEqual(imp({ heightFt: '5.11' }).error, 'HEIGHT_FEET_NOT_WHOLE');
  ok(imp({ heightFt: '5', heightIn: '11' }));
});
// contract change 2026-11-22 review: 66 lb and 3 ft 3 in are now REJECTED (29.9 kg / 99.1 cm); 67 lb, 3 ft 4 in, 8 ft 2 in, 661 lb accepted.
test('AC19 (revised) 3 ft 3 in (99.1 cm) and 66 lb (29.9 kg) REJECTED; 3 ft 4 in, 67 lb, 8 ft 2 in, 661 lb ACCEPTED  [contract change 2026-11-22 review]', () => {
  near(A.lbToKg(66), 29.94, 0.01); near(A.ftInToCm(3, 3), 99.06, 0.01);
  let r = imp({ heightFt: '3', heightIn: '3', weightLb: '100' });
  assert.strictEqual(r.error, 'HEIGHT_OUT_OF_RANGE'); assert.strictEqual(r.field, 'height');
  r = imp({ weightLb: '66' });
  assert.strictEqual(r.error, 'WEIGHT_OUT_OF_RANGE'); assert.strictEqual(r.field, 'weight');
  ok(imp({ heightFt: '3', heightIn: '4', weightLb: '100' }));
  ok(imp({ weightLb: '67' }));
  ok(imp({ heightFt: '8', heightIn: '2', weightLb: '200' }));
  ok(imp({ heightFt: '7', heightIn: '0', weightLb: '661' }));
  ok(imp({ heightFt: '8', heightIn: '2', weightLb: '661' }));
});
test('AC19 (revised) boundaries follow metric limits at 0.1 precision: 66.0 lb no / 66.1 lb yes; 661.4 lb yes / 661.5 lb no; 3 ft 3.3 in no / 3.4 yes; 8 ft 2.4 in yes / 8 ft 2.5 in no  [contract change 2026-11-22 review]', () => {
  assert.strictEqual(imp({ weightLb: '65.9' }).error, 'WEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ weightLb: '66.0' }).error, 'WEIGHT_OUT_OF_RANGE');
  ok(imp({ weightLb: '66.1' }));
  ok(imp({ heightFt: '7', heightIn: '0', weightLb: '661.4' }));
  assert.strictEqual(imp({ heightFt: '7', heightIn: '0', weightLb: '661.5' }).error, 'WEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightFt: '7', heightIn: '0', weightLb: '700' }).error, 'WEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightFt: '3', heightIn: '2.9', weightLb: '100' }).error, 'HEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightFt: '3', heightIn: '3.3', weightLb: '100' }).error, 'HEIGHT_OUT_OF_RANGE');
  ok(imp({ heightFt: '3', heightIn: '3.4', weightLb: '100' }));
  ok(imp({ heightFt: '8', heightIn: '2.1', weightLb: '200' }));   // 249.2 cm: accepted (old limit rejected it)
  ok(imp({ heightFt: '8', heightIn: '2.4', weightLb: '200' }));
  assert.strictEqual(imp({ heightFt: '8', heightIn: '2.5', weightLb: '200' }).error, 'HEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightFt: '9', heightIn: '0', weightLb: '200' }).error, 'HEIGHT_OUT_OF_RANGE');
  // format rules still checked before conversion
  assert.strictEqual(imp({ heightIn: '12' }).error, 'HEIGHT_OUT_OF_RANGE');
  assert.strictEqual(imp({ heightIn: '-0.1' }).error, 'HEIGHT_OUT_OF_RANGE');
  ok(imp({ heightIn: '11.99' }));
  assert.strictEqual(assess(metric({ heightCm: 250, weightKg: 301, age: 30, sex: 'male' })).error, 'WEIGHT_OUT_OF_RANGE');
});

// ---------------- AC22 ----------------
test('AC22 unit round trip stays valid: 250 cm/300 kg -> 8 ft 2.4 in / 661.4 lb and Calculate gives a result; 100 cm/30 kg likewise', () => {
  const a = switchUnits({ heightCm: '250', weightKg: '300' }, 'imperial');
  assert.deepStrictEqual([a.heightFt, a.heightIn, a.weightLb], ['8', '2.4', '661.4']);
  ok(assess(Object.assign({ units: 'imperial', age: '30', sex: 'male' }, a)));
  const b = switchUnits({ heightCm: '100', weightKg: '30' }, 'imperial');
  ok(assess(Object.assign({ units: 'imperial', age: '30', sex: 'male' }, b)));
});
test('AC22 (sweep) every valid height (100.0-250.0 cm) and weight (30.0-300.0 kg) in 0.1 steps survives metric -> imperial without a range/format error', () => {
  const fatal = ['HEIGHT_OUT_OF_RANGE', 'WEIGHT_OUT_OF_RANGE', 'HEIGHT_FEET_NOT_WHOLE', 'MISSING_VALUE', 'NOT_A_NUMBER'];
  for (let i = 1000; i <= 2500; i++) {
    const cm = (i / 10).toFixed(1);
    const c = switchUnits({ heightCm: cm, weightKg: '70.0' }, 'imperial');
    const r = assess({ units: 'imperial', heightFt: c.heightFt, heightIn: c.heightIn, weightLb: c.weightLb, age: '30', sex: 'male' });
    const bad = (r.errors || []).filter((e) => fatal.includes(e.error));
    // test defect fixed: r.errors is a vm-realm array, so deepStrictEqual(bad, []) fails on prototype even when empty.
    assert.strictEqual(bad.length, 0, `height ${cm} cm -> ${c.heightFt} ft ${c.heightIn} in: ${JSON.stringify(bad)}`);
  }
  for (let i = 300; i <= 3000; i++) {
    const kg = (i / 10).toFixed(1);
    const c = switchUnits({ heightCm: '175.0', weightKg: kg }, 'imperial');
    const r = assess({ units: 'imperial', heightFt: c.heightFt, heightIn: c.heightIn, weightLb: c.weightLb, age: '30', sex: 'male' });
    const bad = (r.errors || []).filter((e) => fatal.includes(e.error) && e.field === 'weight');
    assert.strictEqual(bad.length, 0, `weight ${kg} kg -> ${c.weightLb} lb: ${JSON.stringify(bad)}`);
  }
});

// ---------------- AC23 ----------------
test('AC23 imperial blank feet + inches 70 switched to metric leaves cm EMPTY (not 177.8); assess says MISSING_VALUE height', () => {
  let o = switchUnits({ heightFt: '', heightIn: '70', weightLb: '' }, 'metric');
  assert.strictEqual(o.heightCm, '');
  o = switchUnits({ heightFt: '   ', heightIn: '70', weightLb: '150' }, 'metric');
  assert.strictEqual(o.heightCm, ''); assert.strictEqual(o.weightKg, '68.0');
  const r = imp({ heightFt: '', heightIn: '70' });
  assert.strictEqual(r.error, 'MISSING_VALUE'); assert.strictEqual(r.field, 'height');
  // feet present with blank inches still converts (inches count as 0)
  assert.strictEqual(switchUnits({ heightFt: '5', heightIn: '', weightLb: '' }, 'metric').heightCm, (5 * 12 * 2.54).toFixed(1));
});

// ---------------- AC25 ----------------
test('AC25 "70,5" and "70kg" in weight, "abc" in age -> NOT_A_NUMBER; blank fields stay MISSING_VALUE', () => {
  bad({ weightKg: '70,5' }, 'NOT_A_NUMBER', 'weight'); bad({ weightKg: '70kg' }, 'NOT_A_NUMBER', 'weight');
  bad({ age: 'abc' }, 'NOT_A_NUMBER', 'age'); bad({ heightCm: '170cm' }, 'NOT_A_NUMBER', 'height');
  bad({ weightKg: '' }, 'MISSING_VALUE', 'weight'); bad({ age: '   ' }, 'MISSING_VALUE', 'age'); bad({ heightCm: '' }, 'MISSING_VALUE', 'height');
});
test('AC25 imperial text fields: non-numeric feet / inches / pounds -> NOT_A_NUMBER; and errors list keeps form order with mixed codes', () => {
  assert.strictEqual(imp({ heightFt: 'abc' }).error, 'NOT_A_NUMBER');
  assert.strictEqual(imp({ heightIn: '5,5' }).error, 'NOT_A_NUMBER');
  const w = imp({ weightLb: '150lb' }); assert.strictEqual(w.error, 'NOT_A_NUMBER'); assert.strictEqual(w.field, 'weight');
  const r = assess({ units: 'metric', heightCm: 'abc', weightKg: '', age: 'xyz', sex: '' });
  assert.deepStrictEqual(Array.from(r.errors, (e) => e.error + ':' + e.field),
    ['NOT_A_NUMBER:height', 'MISSING_VALUE:weight', 'NOT_A_NUMBER:age', 'SEX_REQUIRED:sex']);
});

// ---------------- AC26 (logic part: still rejected on the age field) ----------------
test('AC26 age 15 / 0 / -3 (below 16) and 101 / 30.5 are rejected on the age field (message text is checked in the browser suite)', () => {
  for (const a of [15, '15', 0, '-3']) { const r = assess(Object.assign({}, base, { age: a })); assert.ok(r.error && r.field === 'age', String(a)); }
  for (const a of [101, '30.5']) { const r = assess(Object.assign({}, base, { age: a })); assert.ok(r.error && r.field === 'age', String(a)); }
});

// ---------------- AC24 (logic: only what the spec states) ----------------
test('AC24 oracle precondition: AC1 raw formulas all inside 0-100, extreme male 20/200 cm/40 kg has a raw value outside (warning trigger); result values stay clamped', () => {
  const ac1 = ok(assess(metric({ heightCm: 180, weightKg: 80, age: 30, sex: 'male' })));
  const rawA = rawBF(ac1.bmi, 30, 'male');
  assert.ok(Object.values(rawA).every(within), JSON.stringify(rawA));
  const ex = ok(assess(metric({ heightCm: 200, weightKg: 40, age: 20, sex: 'male' })));
  assert.ok(Object.values(rawBF(ex.bmi, 20, 'male')).some((x) => !within(x)));
  assert.ok(['deurenberg', 'gallagher', 'cunbae'].every((k) => within(ex.bodyFat[k])));
});

// ---------------- AC21 ----------------
test('AC21 male 16, 170 cm, 80.5 kg vs 80.6 kg: same BMI, percentile text and category', () => {
  const a = ok(teen(16, 'male', 80.5 / 2.89)), b = ok(teen(16, 'male', 80.6 / 2.89));
  const c = ok(assess(metric({ heightCm: 170, weightKg: 80.5, age: 16, sex: 'male' })));
  const d = ok(assess(metric({ heightCm: 170, weightKg: 80.6, age: 16, sex: 'male' })));
  assert.strictEqual(c.bmiRounded, d.bmiRounded); assert.strictEqual(c.bmiRounded.toFixed(1), '27.9');
  assert.strictEqual(c.percentileLabel, d.percentileLabel);
  assert.strictEqual(c.percentile, d.percentile, 'percentile is computed from the displayed BMI, so identical');
  assert.strictEqual(c.category, d.category); assert.strictEqual(c.label, d.label);
  assert.strictEqual(a.percentileLabel, b.percentileLabel);
});
test('AC21 (sweep) equal displayed BMI => equal percentile label and category, all teen ages/sexes, weights 0.1 kg apart', () => {
  for (const sex of ['male', 'female']) for (const age of [16, 17, 18, 19]) {
    const seen = new Map();
    for (let w = 40; w <= 130; w = Math.round((w + 0.1) * 10) / 10) {
      const r = ok(assess(metric({ heightCm: 170, weightKg: w, age, sex })));
      const key = r.bmiRounded, val = r.percentileLabel + '|' + r.label;
      if (seen.has(key)) assert.strictEqual(val, seen.get(key), `${sex}${age} BMI ${key} @${w}kg`); else seen.set(key, val);
    }
  }
});

// ---------------- round1 / unit-switch / static contract changes ----------------
test('round1 exact half: 104 cm / 33.8 kg -> 31.3 (BMI 31.25)', () => {
  const r = ok(assess(metric({ heightCm: 104, weightKg: 33.8, age: 30, sex: 'male' })));
  assert.strictEqual(r.bmiRounded, 31.3); assert.strictEqual(r.bmiRounded.toFixed(1), '31.3'); assert.strictEqual(r.label, 'Obesity');
});
test('switchUnits carries unparseable text as typed (never blanks it); blank stays blank', () => {
  let o = switchUnits({ heightCm: 'abc', weightKg: '7x' }, 'imperial');
  assert.strictEqual(o.heightFt, 'abc'); assert.strictEqual(o.heightIn, ''); assert.strictEqual(o.weightLb, '7x');
  o = switchUnits({ heightFt: '5.x', heightIn: '3', weightLb: 'abc' }, 'metric');
  assert.strictEqual(o.heightCm, '5.x'); assert.strictEqual(o.weightKg, 'abc');
  o = switchUnits({ heightFt: '5', heightIn: 'q', weightLb: '' }, 'metric');
  assert.strictEqual(o.heightCm, 'q'); assert.strictEqual(o.weightKg, '');
  // contract change 2026-11-22 review: blank feet + inches typed is a MISSING height, so the cm field stays empty (was 15.2 cm).
  o = switchUnits({ heightFt: '', heightIn: '6', weightLb: '' }, 'metric');
  assert.strictEqual(o.heightCm, '');
  o = switchUnits({ heightFt: '', heightIn: '', weightLb: '' }, 'metric');
  assert.strictEqual(o.heightCm, ''); assert.strictEqual(o.weightKg, '');
  o = switchUnits({ heightCm: '', weightKg: '' }, 'imperial');
  assert.strictEqual(o.heightFt, ''); assert.strictEqual(o.heightIn, ''); assert.strictEqual(o.weightLb, '');
});
test('Static: CSP meta present and forbids network sources; summary sr-only with aria-hidden visual duplicates', () => {
  const csp = html.match(/<meta[^>]+http-equiv="Content-Security-Policy"[^>]*content="([^"]*)"/i);
  assert.ok(csp, 'CSP meta present');
  assert.match(csp[1], /default-src\s+'none'/);
  assert.doesNotMatch(csp[1], /https?:|\*|connect-src/);
  assert.match(html, /bmi__sr-only/); assert.match(html, /setAttribute\('aria-hidden', 'true'\)/);
});

// ---------------- AC24 (logic): bodyFat().clamped ----------------
test('AC24 bodyFat().clamped is true iff any raw formula is outside 0-100 (oracle grid, both sexes, ages 20-100, BMI 10-80)', () => {
  let seenTrue = 0, seenFalse = 0;
  for (const sex of ['male', 'female']) for (const age of [20, 30, 40, 65, 100]) for (let b = 10; b <= 80; b += 1.5) {
    const raw = rawBF(b, age, sex);
    if (Object.values(raw).some((v) => Math.min(Math.abs(v), Math.abs(v - 100)) < 1e-6)) continue;
    const want = Object.values(raw).some((v) => !within(v));
    const got = bodyFat(b, age, sex);
    assert.strictEqual(got.clamped, want, `${sex} ${age} BMI ${b} raw ${JSON.stringify(raw)}`);
    want ? seenTrue++ : seenFalse++;
  }
  assert.ok(seenTrue > 0 && seenFalse > 0, `grid must hit both outcomes (${seenTrue}/${seenFalse})`);
});
test('AC24 assess(): male 20/200 cm/40 kg -> bodyFat.clamped true; male 30/180 cm/80 kg (AC1) -> false; teen has no body fat', () => {
  assert.strictEqual(ok(assess(metric({ heightCm: 200, weightKg: 40, age: 20, sex: 'male' }))).bodyFat.clamped, true);
  assert.strictEqual(ok(assess(metric({ heightCm: 150, weightKg: 180, age: 100, sex: 'female' }))).bodyFat.clamped, true);
  assert.strictEqual(ok(assess(metric({ heightCm: 180, weightKg: 80, age: 30, sex: 'male' }))).bodyFat.clamped, false);
  assert.strictEqual(ok(assess(metric({ heightCm: 180, weightKg: 80, age: 19, sex: 'male' }))).bodyFat, null);
});

// final error check 2026-11-22: a unit switch must never write "Infinity", "NaN" or exponent text (1e+25) into a field.
// Contract: "Switching units converts any values already entered"; unreadable/unconvertible text is carried over, never mangled (switchUnits comment).
test('final error check 2026-11-22: switchUnits with absurdly large numbers yields no NaN/Infinity/exponent text', () => {
  const bad = /NaN|Infinity|e\+/i;
  for (const digits of [400, 309, 25]) {
    const big = '9'.repeat(digits);
    const toImp = A.switchUnits({ heightCm: big, weightKg: big }, 'imperial');
    for (const [k, v] of Object.entries(toImp)) assert.ok(!bad.test(v), `${digits} digits -> imperial ${k}=${v}`);
    const toMet = A.switchUnits({ heightFt: big, heightIn: '1', weightLb: big }, 'metric');
    for (const [k, v] of Object.entries(toMet)) assert.ok(!bad.test(v), `${digits} digits -> metric ${k}=${v}`);
  }
});

// ---------------- White-box tests (2026-11-22) ----------------
// Written from the code's structure, not the spec: they exist to run branches the black-box tests never reach.

// Independent re-implementation of the displayed-BMI rule, used as an oracle below.
const shown1 = (kg, m) => Math.round(Number(((kg / (m * m)) * 10).toPrecision(12))) / 10;
function bruteEdges(heightM, unitKg) {
  // Lightest and heaviest weight (0.1-unit steps) whose displayed BMI is 18.5-24.9, by exhaustive search.
  let min = null, max = null;
  for (let t = 1; t <= 200000; t++) {
    const b = shown1((t / 10) * unitKg, heightM);
    if (b >= 18.5 && b <= 24.9) { if (min === null) min = t / 10; max = t / 10; }
    if (b > 24.9 && min !== null) break;
  }
  return { min, max };
}

test('white-box: healthyEdges correction loops (unreachable for valid heights 100-250 cm) give correct edges below 1 m', () => {
  // For heights >= 1 m the first guess is always right, so the two `while` correction loops never run in the app.
  // Heights under 1 m make the guess wrong, which runs both loops; the result must still match a brute-force search.
  for (let cm = 30; cm < 100; cm += 1.7) {
    const h = cm / 100;
    const r = healthyWeightRange(h);
    const kg = bruteEdges(h, 1);
    const lb = bruteEdges(h, 0.45359237);
    assert.strictEqual(r.minKg, kg.min, `minKg at ${cm} cm`);
    assert.strictEqual(r.maxKg, kg.max, `maxKg at ${cm} cm`);
    assert.strictEqual(r.minLb, lb.min, `minLb at ${cm} cm`);
    assert.strictEqual(r.maxLb, lb.max, `maxLb at ${cm} cm`);
  }
});

test('white-box: cdcPercentile throws for an unknown sex and for an age with no embedded CDC rows', () => {
  // Validation stops both cases before they reach lmsAt, so only a direct call can run these defensive branches.
  assert.throws(() => A.cdcPercentile(22, 210, 'other'), /Unknown sex/);
  assert.throws(() => A.cdcPercentile(22, 300, 'male'), /No CDC data embedded for age 300 months/);
  assert.throws(() => A.cdcPercentile(22, 100, 'female'), /No CDC data embedded/);
});

test('white-box: switchUnits treats missing (null / undefined) fields as empty text, never "null" or "undefined"', () => {
  // The page always passes strings; this runs the typedText null/undefined branch directly.
  const toImp = switchUnits({ heightCm: null, weightKg: undefined }, 'imperial');
  const toMet = switchUnits({ heightFt: undefined, heightIn: null, weightLb: null }, 'metric');
  for (const v of [toImp.heightFt, toImp.heightIn, toImp.weightLb, toMet.heightCm, toMet.weightKg]) {
    assert.ok(v === '' , `expected empty text, got ${JSON.stringify(v)}`);
  }
});
