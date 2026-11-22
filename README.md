# BMI Calculator

An age- and sex-aware BMI calculator for people aged 16 and over. It is a single self-contained file of vanilla HTML, CSS and JavaScript: no dependencies, no build step, no network access.

- Metric (kg, cm) or imperial (lb, ft + in), with a toggle that converts what you have already typed.
- Ages 16 to 19: BMI-for-age percentile and category from the CDC 2000 growth charts (by sex).
- Ages 20 and over: WHO adult categories, an estimated body-fat percentage (the average of three published formulas, with the range shown), and a healthy weight range for your height.
- A screening tool, not medical advice.

Built as a "vibe coding" exercise: the requirements were written first as a spec (`specs/bmi-calculator.md`), then the app was generated, tested and reviewed against it.

## Files

| Path | What it is |
|------|------------|
| `bmi.html` | The whole app (markup, styles, logic, DOM wiring) |
| `specs/bmi-calculator.md` | The spec: scope, acceptance criteria AC1-AC28, resolved questions, notes for developer/tester |
| `data/` | The official CDC BMI-for-age CSV (`cdc_bmiagerev_190-241.csv`), used by the tests as an independent reference |
| `tests/bmi.test.js` | Logic tests (`node:test`), 73 tests (70 black-box, 3 white-box) |
| `tests/browser_test.py` | Browser tests (Playwright), 102 checks: form, errors, keyboard, accessibility, layout at 320 / 375 / 1280 px |

## Open it

Double-click `bmi.html`. It opens in your default browser and works offline. Fill in the fields and press Calculate (or Enter). Nothing is calculated while you type.

## Run the tests

**Logic tests** need Node.js 18 or newer (built-in `node:test`; nothing to install):

```
node --test tests/bmi.test.js
```

Pass the file path; `node --test tests/` (a directory) does not work on Node 22.

**Browser tests** need Python 3 and Playwright:

```
pip install playwright
python -m playwright install chromium
python tests/browser_test.py
```

Screenshots are saved in `tests/screenshots/`. To use an installed Chrome instead, set `CHROME_PATH` to its location.

## Code map (`bmi.html`)

The file has two `<script>` blocks that are kept strictly separate. All CSS is scoped under the `.bmi` container, apart from the page background.

### `<script id="bmi-logic">` (no DOM)

- **Constants**
  - `LIMITS`: every validation range (age, BMI, metric height/weight, and `imperial.inchesPart` for the inches format rule). The metric limits are the only range limits; imperial range messages are derived from them. It is the single source for both validation and the error-message text.
  - `THRESHOLDS`: category cut-offs. Adult BMI 18.5 / 25 / 30; teen percentiles 5 / 85 / 95; teen severe obesity at BMI 35 or 1.2 x the 95th-percentile BMI; top of the healthy range 24.9.
  - `TEEN_ROUTE`: `maxAge` 19 and `ageMonthsOffset` 6 (age in months = age x 12 + 6).
  - `CDC_LMS`: the CDC L, M, S rows. It is coupled to `TEEN_ROUTE` and `LIMITS.age.min`: only the rows either side of the four midpoint ages (198, 210, 222, 234 months) are embedded, so the table covers exactly ages 16-19. Changing the teen age range means embedding new rows.
  - `CATEGORY_LABELS`: the text shown for each category.
- **Parsing and conversion:** `parseNumber`, `isBlank`, `round1`, `lbToKg`, `kgToLb`, `ftInToCm`, `cmToFtIn`, `blankAsZero`, `badNumberCode` (blank gives MISSING_VALUE, other unreadable text gives NOT_A_NUMBER), `readInput` (parses every field once; no range checks), `toMetric`, `switchUnits` (converts typed values when the unit toggle changes; unreadable text is carried over, never blanked; blank feet gives an empty cm field, matching validation).
- **Formulas:** `bmi`; `bodyFat` (Deurenberg, Gallagher and CUN-BAE, each clamped to 0-100% before averaging; returns `clamped: true` when any raw value was outside the range); `cdcPercentile` with `normalCdf` and `lmsAt` (linear interpolation between CDC rows); `formatPercentile`; `healthyEdges` (walks in 0.1 steps to the lightest and heaviest weight whose displayed BMI is 18.5-24.9) and `healthyWeightRange` -> `{minKg, maxKg, minLb, maxLb}` (lb computed directly, not converted; 59.8-80.8 kg / 131.8-178.2 lb at 180 cm).
- **Validation:** `validate(input)` runs the `check*` helpers (`checkHeight`, `checkWeight`, `checkCombination`, `checkAge`, `checkSex`) in a fixed order: height, weight, combination, age, sex. Imperial format rules (feet whole, 0 <= inches < 12) are checked first; the converted value, rounded to 0.1 cm / 0.1 kg, is then checked against the metric limits (100-250 cm, 30-300 kg). The combination (BMI) check runs only when height and weight are each valid and is reported on field `height`. It returns every error plus the parsed values. Error codes: MISSING_VALUE, NOT_A_NUMBER, AGE_NOT_WHOLE, AGE_OUT_OF_RANGE, HEIGHT_FEET_NOT_WHOLE, HEIGHT_OUT_OF_RANGE, WEIGHT_OUT_OF_RANGE, BMI_IMPLAUSIBLE, SEX_REQUIRED.
- **Assessment:** `assess(input)` is the only entry point. It calls `validate()`, then makes the single teen-or-adult route decision and calls `assessTeen` or `assessAdult`. It returns a result object, or `{error, field, errors}`.
- **Exports:** a `module.exports` line, active only when `module` exists (so tests can load the block and the browser ignores it).

### `<script id="bmi-dom">` (DOM only)

- `FIELDS`: maps each field name to its input controls and message element.
- `messageFor`: turns an error code into text, with ranges read from `LIMITS` (imperial ranges are the metric limits converted and rounded inward; age under 16 gets its own message).
- `showError` / `clearError`: set or remove the message, `aria-invalid`, `aria-describedby` and the red border. The combination message appears just above the Calculate button and marks both height and weight.
- `summaryFor`: fills the `#error-summary` live region ("3 fields need attention: height, age, sex"); cleared when no message is left on screen.
- `renderResult`: builds the result card (screen-reader summary plus aria-hidden visual lines, the body-fat unreliable warning when `bodyFat.clamped`, and a closing "Screening tool, not medical advice." line).
- Security: the page's CSP is `default-src 'none'` plus inline script/style, `img-src data:`, `form-action 'none'` and `base-uri 'none'`.
- Events: submit runs `assess()`; any edit or unit switch hides a stale result; editing a field clears its own error; the unit switch calls `switchUnits` and relabels the fields.

**How the tests load the logic:** `tests/bmi.test.js` reads `bmi.html`, extracts the `bmi-logic` block with a regex and runs it in a `node:vm` sandbox. The tests exercise the exact code the browser runs, with no copy to keep in sync.

## Data

`data/cdc_bmiagerev_190-241.csv` holds the official CDC BMI-for-age LMS rows (Agemos 190.5 to 240.5 range). It is not read by the app; it is the reference for the tests. The logic tests check that every embedded `CDC_LMS` row matches the CSV exactly (L, M and S, no drift) and that the rows bracketing each of the ages 16-19 are present. Expected teen percentiles are computed independently from the CSV, with their own high-precision normal CDF, and compared with the app.

## Key behaviour decisions

From the spec's "Resolved questions":

- **Category comes from the rounded, displayed BMI**, so the number and the label always agree (e.g. 24.96 shows 25.0 and "Overweight").
- **Teen percentile is computed from the displayed BMI** and truncated (never rounded up), with "<1st" and ">99th" at the ends. Equal displayed BMIs always give the same percentile and label.
- **No body-fat estimate under 20.** Teens get a percentile only; adults get the average of three formulas plus the "Formulas ranged X-Y%" line.
- **Body-fat formulas are clamped to 0-100%** each, then averaged. The result is always shown (the alternative, hiding it for extreme BMIs, was rejected).
- **BMI below 10 or above 80 is rejected** as an unrealistic height and weight combination.
- **Healthy weight range follows the rounded-BMI rule:** the lightest to heaviest weight (0.1 steps) whose displayed BMI is 18.5-24.9, so it always agrees with the category (59.8-80.8 kg at 180 cm).
- **Imperial limits are derived from the metric ones:** values are converted, rounded to 0.1 cm / 0.1 kg and checked against 100-250 cm and 30-300 kg (so unit-switch results are never rejected by rounding). Messages read "3 ft 4 in to 8 ft 2 in" and "67 to 661 lb". Feet must be whole and inches 0 up to (not including) 12 (format rules).
- **Error wording:** non-blank text that is not a number gives "Use digits only, e.g. 70.5" (NOT_A_NUMBER); blank gives "Enter your ...". Age under 16 gets "This calculator is for ages 16 and over".
- **Combination error** marks both height and weight; a screen-reader summary names every field with an error.
- **Body-fat warning** appears when any formula was clamped; a disclaimer line also ends the result card.
- **Age is a whole number from 16 to 100;** age 65 and over adds a note that BMI can underestimate body fat.
- **Sex is Male or Female only**, because the reference data exists only for these.
- **Bone density is not included** (it cannot be estimated from these inputs); no ethnicity-specific cut-offs.

## Sources

- CDC 2000 BMI-for-age growth charts
- WHO adult BMI classification
- Deurenberg et al. 1991
- Gallagher et al. 2000
- CUN-BAE (Gomez-Ambrosi et al. 2012)

## Known follow-ups

Open items (the blank-feet unit-switch mismatch and the 11.99 message are fixed):

- **Route helpers return different shapes:** `assessTeen` and `assessAdult` fill the result object in place with different fields (percentile fields for teens; body fat and healthy range for adults), so the result has no single fixed shape.
- **Not automatically tested:** WCAG colour contrast and real screen readers (the tests check ARIA attributes and markup only).
- **">99th" label covers 99.0-99.99:** the label is shown for any percentile of 99 or above.
- **Ages 81-100 use CUN-BAE beyond its study range,** with no note shown.
- **Unit toggling can drift typed values by 0.1** (each switch rounds to 1 decimal).
- **Typed metric height such as 180.04:** the healthy range is for 180.0 cm (0.1 rounding) but BMI uses 180.04.
- **Untested gaps:** `healthyWeightRange` lb fields at logic level; error-summary wording for the combination case; the metric 0.1-rounding boundary (99.96 cm / 29.96 kg).
- **Unit switch converts imperial entries that break the format rules** (e.g. 5 ft 15 in or 5.5 ft becomes a valid 190.5 cm), so the error is only caught if Calculate is pressed before switching.
- **Screen-reader error summary can go stale:** after fixing one of several errors it still says e.g. "3 fields need attention" until all are fixed.
- **Only Chromium is tested automatically;** Firefox and Safari have not been run.

Fixed in the final error check (2026-11-22): pasting a 22+ digit number and switching units no longer writes "Infinity", "NaN" or exponent text into the boxes.

## Testing tools

`npm test` runs the logic tests; `npm run test:browser` runs the browser tests; `npm run coverage` prints white-box coverage of the logic. Install the pinned browser-test tool with `pip install -r requirements-dev.txt` and `python -m playwright install chromium`. On GitHub, `.github/workflows/tests.yml` runs both suites on every push.

## White-box testing

`npm run coverage` (`tests/coverage.js`) runs the logic tests with V8 coverage switched on and reports which lines of the `bmi-logic` script ran. A custom script is needed because the tests load the logic through `node:vm`, which Node's built-in `--experimental-test-coverage` does not report. Current result: 354 / 354 code lines and 38 / 38 functions run.

Before the white-box tests were added, 5 lines never ran. Three white-box tests (end of `tests/bmi.test.js`) now cover them:

| Code | Why black-box tests never reached it | White-box test |
| --- | --- | --- |
| `healthyEdges`: the two correcting `while` loops | Unreachable for valid heights: an exhaustive check of all 150,001 heights from 100 to 250 cm (0.001 cm steps) never runs them, because the rounded first guess is off by under 0.05 of a unit, too little to change the displayed BMI when height is at least 1 m. They are kept because the exported function is meant to work at any height. | Heights 30-99 cm compared with a brute-force search (kg and lb) |
| `lmsAt`: "Unknown sex" and "No CDC data" errors | Validation rejects these inputs first | Direct `cdcPercentile` calls with a bad sex and out-of-range ages |
| `typedText`: the null / undefined branch | The page always passes strings | `switchUnits` called with missing fields |
