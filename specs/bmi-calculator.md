---
title: BMI Calculator (age- and sex-aware)
status: built
built: 2026-11-22
date: 2026-11-22
---

# BMI Calculator — Spec

## 1. Problem
Standard BMI calculators give everyone the same categories and say nothing about body fat, even though the same BMI means different things for teenagers (who are still growing) and for adults of different age and sex. The user wants a BMI tool that accounts for age and sex using published methods, and a second vibe-coded portfolio piece built spec-first like their Simple-calc calculator.

## 2. Users and expectations
- People aged 16+ (teens 16–19 and adults) checking their BMI on phone or desktop.
- They expect: enter units they know (metric or imperial), get a clear number, a category that is correct for their age/sex, and an honest note on limits. Not medical advice.

## 3. Objective and success signal
- Objective: a single-page BMI calculator that gives age/sex-appropriate categories and an averaged body-fat estimate for adults.
- Success: all acceptance criteria below pass in automated tests; published on GitHub Pages and linked from the user's profile like Simple-calc.

## 4. INCLUDED scope
- Units toggle: Metric (kg, cm) / Imperial (lb, ft + in). Default Metric.
- Inputs: height, weight, age (whole years), sex (Male / Female, labelled "Sex (used by growth charts)").
- Calculate button (Enter also submits). No live calculation while typing.
- Switching units converts any values already entered (not cleared).
- BMI = kg / m², displayed to 1 decimal place.
- **Category is decided from the rounded, displayed BMI** (so the number and label always agree).
- **Ages 16–19 (teen route):** CDC 2000 BMI-for-age percentile using LMS parameters for the person's sex at age-in-months = age × 12 + 6 (midpoint of that year). Show percentile (whole number, "th" suffix) and CDC category: Underweight < 5th; Healthy weight 5th to < 85th; Overweight 85th to < 95th; Obesity ≥ 95th; Severe obesity (shown as "Obesity (severe)") if BMI ≥ 120% of the 95th percentile or BMI ≥ 35. No body-fat estimate for teens.
- **Ages 20+ (adult route):** WHO categories on rounded BMI: Underweight < 18.5; Healthy weight 18.5–24.9; Overweight 25.0–29.9; Obesity ≥ 30.0. Plus estimated body fat % = arithmetic mean of three published formulas, displayed to 1 decimal, with a line "Formulas ranged X–Y%":
  - Deurenberg 1991: BF% = 1.2×BMI + 0.23×age − 10.8×S − 5.4 (S = 1 male, 0 female)
  - Gallagher 2000: BF% = 64.5 − 848×(1/BMI) + 0.079×age − 16.4×S + 0.05×S×age + 39.0×S×(1/BMI) (S = 1 male, 0 female)
  - CUN-BAE: BF% = −44.988 + 0.503×age + 10.689×F + 3.172×BMI − 0.026×BMI² + 0.181×BMI×F − 0.02×BMI×age − 0.005×BMI²×F + 0.00021×BMI²×age (F = 1 female, 0 male — note opposite coding)
  - Body-fat formulas use the unrounded BMI.
  - Each formula's result is clamped to 0–100% before averaging; the range line uses the clamped values. (Decided after audit: always show, never hide.)
- Ages 65+: extra note "BMI can underestimate body fat in older adults."
- Healthy weight range for the person's height (adults only), in the selected unit: from the lightest to the heaviest weight (in 0.1 kg or 0.1 lb steps) whose displayed BMI is 18.5–24.9, so the range always agrees with the category rule. (Revised after review 2026-11-22: was raw BMI 18.5–24.9.)
- Result card colour-coded by category: blue = underweight, green = healthy, amber = overweight, red = obesity (always with the text label, never colour alone).
- Always-visible line: "A screening tool, not medical advice."
- Short "About this calculator" note: what BMI can't tell you (muscle vs fat, bone density not included and why), sources (CDC, WHO, the three formula papers).
- Input validation with specific messages; no result shown when any input is invalid:
  - Age: whole number 16–100
  - Height: 100–250 cm. Weight: 30–300 kg. These metric limits are the only range limits: imperial entries are converted and checked against them, using the converted value rounded to 0.1 cm / 0.1 kg (so values produced by a unit switch are never rejected by rounding). (Revised after review 2026-11-22: replaces separate imperial limits.)
  - Imperial format rules (checked before conversion): feet a whole number; inches 0 up to (not including) 12.
  - Imperial range messages show the metric limits converted and rounded inward: "Height must be 3 ft 4 in to 8 ft 2 in", "Weight must be 67 to 661 lb".
  - Sex: required
  - Text that is not blank but is not a number (e.g. "70,5", "70kg") gets error NOT_A_NUMBER, message "Use digits only, e.g. 70.5" — distinct from MISSING_VALUE ("Enter your …") for blank fields.
  - Age below 16 gets the message "This calculator is for ages 16 and over"; other invalid ages keep "Age must be a whole number from 16 to 100".
  - Combination check: if the displayed (rounded) BMI < 10 or > 80, reject with "Please check your height and weight — this combination isn't realistic." (error code BMI_IMPLAUSIBLE; decided after audit). Both the height and weight controls are marked invalid and linked to this message.
  - When errors are shown, a screen-reader summary is announced (e.g. "3 fields need attention: height, age, sex").
- Editing any input or switching units hides the previous result until Calculate is pressed again.
- Unit switch converts only values that validation would read as numbers; anything else is carried over as typed. In imperial, blank feet with inches typed is a missing height (same as on Calculate), so switching to metric leaves the cm field empty. (Bug fix 2026-11-22.)
- Body-fat warning: if any formula's raw value fell outside 0–100% (so it was clamped), the card adds "At this BMI the formulas fall outside the range they were developed for; this estimate is unreliable." (User decision after review 2026-11-22.)
- The result card ends with a short disclaimer line "Screening tool, not medical advice." in addition to the one under the title, so it is visible next to the result on phones.
- Teen percentile is computed from the displayed (rounded) BMI and shown truncated to a whole number ("<1st" below 1, ">99th" at 99 or above), so the percentile and label always agree.
- Light theme: white/very light grey background, dark text; blue primary accent (Calculate button, toggle active state, focus ring) and green secondary accent. All text meets WCAG AA contrast (≥ 4.5:1 normal text).
- Responsive 320 px → desktop; controls ≥ 44 px tall; full keyboard use; labels on every input; result announced to screen readers.
- Single self-contained HTML file `bmi.html`, vanilla HTML/CSS/JS, no external dependencies (CDC LMS data embedded).
- Automated tests: Node `node:test` logic tests + Playwright browser tests, as in Simple-calc.

## 5. EXCLUDED scope
- Bone-density adjustment (no validated way to estimate from height/weight/age/sex).
- Averaging different BMI formulas (e.g. Trefethen "new BMI").
- Body-fat estimate for teens.
- Anyone under 16; date-of-birth input; months input.
- Ethnicity-specific cut-offs (e.g. Asian BMI thresholds).
- Saving history, accounts, charts over time, sharing.
- Waist circumference or other measurements.
- Dark mode toggle.

## 6. Priority
Medium — second portfolio project; no external deadline. Correctness of categories and formulas outranks visual polish because wrong health information is the main way this fails.

## 7. Acceptance criteria
- AC1 Male, 30, 180 cm, 80 kg → BMI 24.7, "Healthy weight", body fat 20.4% (each formula: Deurenberg 20.3, Gallagher 19.2, CUN-BAE 21.6 ±0.1), range line "19.2–21.6%".
- AC2 Female, 45, 165 cm, 68 kg → BMI 25.0, "Overweight" (rounded-value rule), body fat 35.1% ±0.1.
- AC3 Male, 70, 175 cm, 60 kg → BMI 19.6, "Healthy weight", body fat 19.9% ±0.1, 65+ note shown.
- AC4 Imperial Male, 30, 5 ft 11 in, 176.4 lb → BMI 24.6 (matches metric equivalent 180.34 cm / 80.01 kg within 0.1).
- AC5 Enter 70 kg and 175 cm, switch to Imperial → weight shows 154.3 lb, height 5 ft 8.9 in (within 0.1 in); switching back restores 70.0 kg and 175.0 cm (within 0.1).
- AC6 Teen route: for ages 16, 17, 18, 19, both sexes, at a BMI near the 5th, 50th, 85th and 95th percentiles, the computed percentile matches the CDC LMS calculation for (age×12+6) months within 1 percentile, and the category matches the CDC thresholds; no body-fat estimate is shown.
- AC7 Teen severe obesity: a teen BMI ≥ 35 (or ≥ 120% of 95th percentile) shows "Obesity (severe)".
- AC8 Age 20 uses the adult route; age 19 uses the teen route.
- AC9 Invalid inputs each show a specific error and no result: age 15, age 101, age 30.5, height 90 cm, height 260 cm, weight 25 kg, weight 400 kg, empty fields, no sex selected. The logic function rejects these too (not only the form).
- AC10 Category boundaries on rounded BMI: 18.4 → Underweight, 18.5 → Healthy, 24.9 → Healthy, 25.0 → Overweight, 29.9 → Overweight, 30.0 → Obesity.
- AC11 Healthy weight range for 180 cm shows 59.8–80.8 kg in metric and 131.8–178.2 lb in imperial (adults only); for 180 cm, adult, 59.8 kg and 80.8 kg are "Healthy weight", 59.7 kg is "Underweight" and 80.9 kg is "Overweight".
- AC12 "A screening tool, not medical advice." is visible on load; with a result, the card itself also contains "Screening tool, not medical advice."
- AC13 At 320 px and 375 px width: no horizontal scroll, all controls ≥ 44 px tall; works at desktop width.
- AC14 Keyboard only: can fill every field, switch units, choose sex, and submit with Enter; visible focus ring on every control.
- AC15 Every input has a visible label; the result region is announced to screen readers (aria-live).
- AC16 No console errors; no network requests (fully offline single file).
- AC17 Body fat is never shown below 0% or above 100%: for valid extremes such as male 20, 200 cm, 40 kg (BMI 10.0) and female 100, 150 cm, 180 kg (BMI 80.0), every formula value, the average and the range lie within 0–100%.
- AC18 BMI < 10 or > 80 is rejected with the combination message and no result (e.g. 250 cm / 30 kg; 100 cm / 300 kg); BMI exactly 10.0 and 80.0 are accepted.
- AC19 Imperial (with plausible partners): "5.11" ft is rejected (feet must be whole); inches 12 rejected; 3 ft 3 in (99.1 cm) and 66 lb (29.9 kg) are rejected; 3 ft 4 in, 67 lb, 8 ft 2 in and 661 lb are accepted; messages read "3 ft 4 in to 8 ft 2 in" and "67 to 661 lb".
- AC20 After a result is shown, editing any field or switching units hides the result.
- AC21 Male 16, 170 cm, 80.5 kg and 80.6 kg show the same BMI, same percentile text and same category.
- AC22 Unit round trip stays valid: 250 cm / 300 kg (adult, sex chosen) switched to imperial shows 8 ft 2.4 in / 661.4 lb and Calculate gives a result; 100 cm / 30 kg likewise.
- AC23 Bug: imperial with feet blank and inches 70, switched to metric, leaves the cm field empty (not 177.8); Calculate then shows "Enter your height".
- AC24 Body-fat warning: male 20, 200 cm, 40 kg shows the "this estimate is unreliable" warning; male 30, 180 cm, 80 kg (AC1) does not.
- AC25 "70,5" and "70kg" in weight, and "abc" in age, show "Use digits only, e.g. 70.5" (NOT_A_NUMBER), not "Enter your …"; blank fields still show "Enter your …".
- AC26 Age 15 shows "This calculator is for ages 16 and over"; age 101 and 30.5 show "Age must be a whole number from 16 to 100".
- AC27 For a combination error (e.g. 100 cm / 300 kg), both height and weight controls have aria-invalid="true" and aria-describedby pointing at the combination message.
- AC28 When errors are shown, a live-region summary names every field with an error, e.g. "3 fields need attention: height, age, sex".

## 8. Known risks
- **Data:** CDC LMS table must be copied exactly; a transcription error silently gives wrong teen categories. Mitigate: fetch from CDC source, test against several known percentile points.
- **Formula transcription:** Gallagher age-term sign and CUN-BAE sex coding are easy to get wrong. Mitigate: verify against original papers; AC1–AC3 pin the values.
- **User harm:** people may treat output as diagnosis. Mitigate: disclaimer, "estimate" wording, range line, About note.
- **Rounding at boundaries:** handled by the rounded-value rule (AC2, AC10).
- **Imperial conversion drift:** single conversion function, round-trip test (AC5).

## Notes for UX
- One column on phone, form then result. Result card: big BMI number, category label + colour, then percentile (teens) or body fat + range (adults), then notes.
- Error messages next to the field, plain words (e.g. "Age must be 16 to 100").
- Colours: blue accent ~#1d4ed8 (white text ≥ 4.5:1), green accent ~#15803d; category colours need text labels and AA contrast.

## Notes for Developer
- One `<script id="bmi-logic">` (no DOM) and one `<script id="bmi-dom">`, like Simple-calc, with `module.exports` when `module` exists.
- Exported logic functions: `toMetric(input)`, `bmi(kg, m)`, `bodyFat(bmi, age, sex)` → {deurenberg, gallagher, cunbae, average, min, max, clamped} (each formula clamped to 0–100%; `clamped` is true when any raw value was outside that range), `cdcPercentile(bmi, ageMonths, sex)` → {percentile, p95}, `assess(input)` → result or `{error, field, errors}` (`errors` lists every problem in form order; `error`/`field` are the first). Also exported: `healthyWeightRange(heightM)` → {minKg, maxKg, minLb, maxLb} (built by `healthyEdges`; lb computed directly, not converted from kg), unit helpers (`lbToKg`, `kgToLb`, `ftInToCm`, `cmToFtIn`, `switchUnits`), `formatPercentile`, `parseNumber`, `CDC_LMS`, `LIMITS`.
- Validation lives in `validate(input)`, which calls the `check*` helpers (`checkHeight`, `checkWeight`, `checkCombination`, `checkAge`, `checkSex`) in fixed form order: height, weight, combination, age, sex. `checkCombination` runs only when height and weight each passed on their own. `validate()` is called only from `assess()`, and `assess()` is also the only place that chooses the teen vs adult route (`age <= TEEN_ROUTE.maxAge`, then `assessTeen` / `assessAdult`). The DOM maps codes to messages (`messageFor`, using the same `LIMITS` table).
- Error codes actually used: MISSING_VALUE, NOT_A_NUMBER (non-blank unreadable text; chosen by `badNumberCode`), AGE_NOT_WHOLE, AGE_OUT_OF_RANGE, HEIGHT_FEET_NOT_WHOLE, HEIGHT_OUT_OF_RANGE, WEIGHT_OUT_OF_RANGE, BMI_IMPLAUSIBLE (reported on field `height`), SEX_REQUIRED.
- Constants: `LIMITS` (`age`, `bmi`, `metric.heightCm` / `metric.weightKg` are the only range limits; `imperial` now holds only `inchesPart`, the 0 ≤ inches < 12 format rule; imperial range messages are derived from the metric limits), `THRESHOLDS` (adult BMI cut-offs 18.5 / 25 / 30; teen percentile cut-offs 5 / 85 / 95; severe obesity BMI 35 or 1.2 × P95; healthy range top 24.9), `TEEN_ROUTE` (`maxAge` 19, `ageMonthsOffset` 6), `CATEGORY_LABELS`. `TEEN_ROUTE` and `LIMITS.age.min` must stay consistent with the embedded `CDC_LMS` rows, which only cover ages 16–19 at age × 12 + 6 months.
- LMS: z = ((BMI/M)^L − 1)/(L·S) (L ≠ 0); percentile = Φ(z)·100; 95th-percentile BMI = M·(1 + L·S·z95)^(1/L) with `z95 = 1.6448536` (more precise than the 1.6449 originally written here). Only the official CDC rows either side of the four midpoint ages (197.5/198.5, 209.5/210.5, 221.5/222.5, 233.5/234.5 months), both sexes, are embedded, copied exactly; `lmsAt` interpolates linearly and throws for any age not bracketed by two rows 1 month apart. Φ uses the Abramowitz and Stegun 7.1.26 erf approximation (error < 1.5e-7).
- Keep it minimal: no extra features beyond this spec.

## Notes for Tester
- Logic tests via vm extraction of `bmi-logic` (as in Simple-calc) covering AC1–AC12, AC15–AC19 and AC21–AC26; teen tests compute expected values independently from the embedded CDC rows.
- Browser tests (Playwright) cover the UI ACs, including AC12–AC14, AC20 and AC22–AC28 (plus AC4–AC5 via the UI and AC9 messages).
- Current counts: 73 node tests (incl. 3 white-box), 102 browser checks; `npm run coverage` reports 100% of logic lines.

## Resolved questions
- Users: adults and teens → age range 16+ (user chose 16, not 13).
- Units: both metric and imperial with a toggle (user).
- Age and sex must affect results (user) → CDC percentiles for 16–19; three-formula body-fat average for 20+.
- Bone density: researched; left out because it can't be estimated from these inputs (user agreed).
- "Calculate 3 ways and average" (user) → Option A: average of three body-fat formulas; BMI itself is single standard formula (user chose A).
- Teens: no body-fat estimate (user: yes).
- Sex options: Male / Female, since reference data exists only for these (assistant default, not objected).
- Input limits, Calculate button, convert on unit switch, rounded-value category rule, average + range line: assistant proposals, accepted when user said to build.
- Theme: light, blue and green accents (user).
- After audit (2026-11-22): body-fat formulas went negative/over 100% at extreme valid inputs → user chose "always show, clamp each formula to 0–100%" over hiding outside a BMI window. Impossible height/weight combinations → user chose to reject BMI < 10 or > 80.
- After audit, assistant calls within existing spec rules: whole feet; imperial limits checked in imperial; stale result hidden on edit; teen percentile from displayed BMI and truncated (keeps number and label in agreement).
- Review 2026-11-22 (request changes), user decisions: healthy range follows the rounded-BMI rule (59.8–80.8 kg at 180 cm); warning shown when body fat was clamped; imperial limits derived from the metric ones (validated in metric at 0.1 precision). Assistant calls: blank feet stays "missing" and the unit switch follows it (empty cm field); NOT_A_NUMBER error; under-16 message; both fields marked for the combination error; error summary for screen readers; disclaimer repeated in the result card. AC11, AC12, AC19 revised; AC22–AC28 added.
