"""Real-browser UI tests for bmi.html. One named record per acceptance criterion (AC1..AC16).

Source of truth: /home/claude/bmi/specs/bmi-calculator.md
Run: CHROME_PATH=/usr/bin/google-chrome python3 tests/browser_test.py
"""
import os
import pathlib
import re
import sys

from playwright.sync_api import sync_playwright

HERE = pathlib.Path(__file__).resolve().parent
URL = (HERE.parent / "bmi.html").as_uri()
SHOTS = HERE / "screenshots"
SHOTS.mkdir(exist_ok=True)
CHROME_PATH = os.environ.get("CHROME_PATH")

DISCLAIMER = "A screening tool, not medical advice."
CARD_DISCLAIMER = "Screening tool, not medical advice."
results = []
console_errors = []
requests_seen = []


def record(name, ok, detail=""):
    results.append((name, ok, detail))
    print(("PASS " if ok else "FAIL ") + name + (f"  [{detail[:200]!r}]" if (detail and not ok) else ""))


def check(name, fn):
    """Run fn(); it returns (ok, detail) or raises AssertionError/Exception -> FAIL."""
    try:
        ok, detail = fn()
    except Exception as e:  # noqa: BLE001 - report any failure as a FAIL with the reason
        ok, detail = False, f"{type(e).__name__}: {str(e)[:300]}"
    record(name, ok, detail)


def new_page(browser, width, height=800):
    page = browser.new_page(viewport={"width": width, "height": height})
    page.on("console", lambda m: console_errors.append(m.text) if m.type == "error" else None)
    page.on("pageerror", lambda e: console_errors.append(str(e)))
    page.on("request", lambda r: requests_seen.append(r.url))
    page.goto(URL)
    return page


# ---- form helpers (semantic locators: labels / roles) ----
def set_units(page, units):
    page.get_by_label("Imperial" if units == "imperial" else "Metric").check()


def fill_metric(page, h=None, w=None, age=None, sex=None):
    if h is not None: page.get_by_label("Height (cm)").fill(str(h))
    if w is not None: page.get_by_label("Weight (kg)").fill(str(w))
    if age is not None: page.get_by_label("Age (years)").fill(str(age))
    if sex: page.get_by_label("Male" if sex == "male" else "Female", exact=True).check()


def calc(page):
    page.get_by_role("button", name="Calculate").click()


def result_text(page):
    return page.locator("#bmi-result").inner_text().strip()


def clear_form(page):
    page.reload()


def no_hscroll(page):
    return page.evaluate("() => [document.documentElement.scrollWidth, document.documentElement.clientWidth, document.body.scrollWidth, window.innerWidth]")


def small_controls(page):
    """Visible interactive controls whose box is under 44px tall (or radios under 44px wide)."""
    return page.evaluate("""() => {
      const bad = [];
      const els = document.querySelectorAll('input, button, summary, select, textarea');
      for (const e of els) {
        const r = e.getBoundingClientRect();
        const cs = getComputedStyle(e);
        if (r.width === 0 || r.height === 0 || cs.display === 'none' || cs.visibility === 'hidden') continue;
        let box = r;
        if (e.type === 'radio') box = r;  // radio fills its 48px label target
        if (box.height < 43.99 || (e.type === 'radio' && box.width < 43.99))
          bad.push((e.id || e.tagName) + ' ' + Math.round(box.width) + 'x' + Math.round(box.height));
      }
      return bad;
    }""")


def ring_info(page):
    """Computed focus-ring of the focused control (radios draw the ring on their sibling span)."""
    return page.evaluate("""() => {
      const a = document.activeElement;
      if (!a || a === document.body) return null;
      const target = a.type === 'radio' ? a.nextElementSibling : a;
      const cs = getComputedStyle(target);
      return {id: a.id || a.tagName, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth),
              color: cs.outlineColor, focusVisible: a.matches(':focus-visible')};
    }""")


def sr_summary(page):
    """Category text from the screen-reader summary paragraph ('Your BMI is 24.7: Healthy weight.')."""
    t = page.locator("#bmi-result p", has_text=re.compile(r"^Your BMI is")).first.text_content()
    m = re.match(r"Your BMI is ([\d.]+): (.*?)(?:, at the |\.$)", t)
    return (m.group(1), m.group(2)) if m else (None, t)


def error_summary(page):
    """Text of a live-region element (aria-live / role alert|status) that summarises the fields needing attention."""
    return page.evaluate("""() => {
      for (const e of document.querySelectorAll('*')) {
        if (e.children.length) continue;
        if (!/attention/i.test(e.textContent)) continue;
        if (e.closest('[aria-live],[role=alert],[role=status]')) return e.textContent.trim();
      }
      return null;
    }""")


def raw_bf(b, age, sex):
    """Independent, unclamped body-fat formulas copied from the spec."""
    S = 1 if sex == "male" else 0
    F = 1 - S
    return [
        1.2 * b + 0.23 * age - 10.8 * S - 5.4,
        64.5 - 848 / b + 0.079 * age - 16.4 * S + 0.05 * S * age + 39.0 * S / b,
        -44.988 + 0.503 * age + 10.689 * F + 3.172 * b - 0.026 * b * b + 0.181 * b * F - 0.005 * b * b * F
        - 0.02 * b * age + 0.00021 * b * b * age,
    ]


with sync_playwright() as p:
    browser = p.chromium.launch(executable_path=CHROME_PATH) if CHROME_PATH else p.chromium.launch()

    # =================== AC12 on load ===================
    page = new_page(browser, 1280)
    check("AC12a disclaimer visible on load",
          lambda: (page.get_by_text(DISCLAIMER, exact=True).is_visible(), ""))

    # =================== AC1-AC3, AC11 via UI (extra confidence on display strings) ===================
    def ac1():
        fill_metric(page, 180, 80, 30, "male"); calc(page)
        t = result_text(page)
        # contract change 2026-11-22 review: AC11 healthy range at 180 cm is now 59.8-80.8 kg (was 59.9-80.7)
        want = ["24.7", "Healthy weight", "20.4%", "Formulas ranged 19.2–21.6%", "59.8–80.8 kg"]
        miss = [w for w in want if w not in t]
        return (not miss, f"missing {miss}; text={t!r}" if miss else "")
    check("AC1 UI male 30/180cm/80kg display (+AC11 range text)", ac1)

    def ac12b():
        return (page.get_by_text(DISCLAIMER, exact=True).is_visible(), "")
    check("AC12b disclaimer visible with an adult result", ac12b)

    def ac2():
        clear_form(page); fill_metric(page, 165, 68, 45, "female"); calc(page)
        t = result_text(page)
        return ("25.0" in t and "Overweight" in t and "35.1%" in t, t)
    check("AC2 UI female 45/165cm/68kg: 25.0 Overweight 35.1%", ac2)

    def ac3():
        clear_form(page); fill_metric(page, 175, 60, 70, "male"); calc(page)
        t = result_text(page)
        return ("19.6" in t and "Healthy weight" in t and "19.9%" in t and "BMI can underestimate body fat in older adults." in t, t)
    check("AC3 UI male 70/175cm/60kg + older-adult note", ac3)

    def ac3b():
        clear_form(page); fill_metric(page, 175, 60, 40, "male"); calc(page)
        return ("older adults" not in result_text(page), "")
    check("AC3b UI older-adult note absent at age 40", ac3b)

    # =================== AC4 ===================
    def ac4():
        clear_form(page); set_units(page, "imperial")
        page.get_by_label("Feet (ft)").fill("5"); page.get_by_label("Inches (in)").fill("11")
        page.get_by_label("Weight (lb)").fill("176.4"); page.get_by_label("Age (years)").fill("30")
        page.get_by_label("Male", exact=True).check(); calc(page)
        t = result_text(page)
        return ("24.6" in t and "Healthy weight" in t, t)
    check("AC4 UI imperial male 30, 5ft 11in, 176.4 lb -> BMI 24.6", ac4)

    def ac4b():  # healthy range displayed in lb in imperial mode
        return (bool(re.search(r"\d+\.\d–\d+\.\d lb", result_text(page))), result_text(page))
    check("AC4b imperial result shows healthy range in lb", ac4b)

    # =================== AC5 ===================
    def ac5():
        clear_form(page); fill_metric(page, 175, 70)
        set_units(page, "imperial")
        w, ft, inch = (page.get_by_label("Weight (lb)").input_value(), page.get_by_label("Feet (ft)").input_value(),
                       page.get_by_label("Inches (in)").input_value())
        if (w, ft) != ("154.3", "5") or abs(float(inch) - 8.9) > 0.1:
            return False, f"imperial got {w} lb, {ft} ft {inch} in"
        set_units(page, "metric")
        kg, cm = page.get_by_label("Weight (kg)").input_value(), page.get_by_label("Height (cm)").input_value()
        return (abs(float(kg) - 70) <= 0.1 and abs(float(cm) - 175) <= 0.1, f"back: {kg} kg {cm} cm")
    check("AC5 UI 70kg/175cm -> 154.3 lb, 5 ft 8.9 in -> back 70.0 kg / 175.0 cm", ac5)

    def ac5b():  # values not cleared with partial inputs; age/sex untouched
        clear_form(page); fill_metric(page, None, 70, 33, "female"); set_units(page, "imperial")
        ok = (page.get_by_label("Weight (lb)").input_value() == "154.3" and page.get_by_label("Feet (ft)").input_value() == ""
              and page.get_by_label("Age (years)").input_value() == "33" and page.get_by_label("Female", exact=True).is_checked())
        return ok, ""
    check("AC5b UI unit switch keeps weight/age/sex; blank height stays blank", ac5b)

    def ac5c():  # carry: 182.87 cm must show 6 ft 0.0 in
        clear_form(page); fill_metric(page, 182.87); set_units(page, "imperial")
        ft, inch = page.get_by_label("Feet (ft)").input_value(), page.get_by_label("Inches (in)").input_value()
        return ((ft, inch) == ("6", "0.0"), f"{ft} ft {inch} in")
    check("AC5c UI 182.87 cm -> 6 ft 0.0 in (no 5 ft 12.0 in)", ac5c)

    # =================== Teen UI (AC6/AC8 display) ===================
    def teen_ui():
        clear_form(page); fill_metric(page, 175, 70, 17, "male"); calc(page)
        t = result_text(page)
        return ("percentile" in t and "Estimated body fat" not in t and "Formulas ranged" not in t
                and "Healthy weight for your height" not in t, t)
    check("AC6/AC8 UI age 17: percentile shown, no body-fat, no healthy range", teen_ui)

    def age_route_ui():
        clear_form(page); fill_metric(page, 175, 70, 19, "female"); calc(page)
        a = result_text(page)
        clear_form(page); fill_metric(page, 175, 70, 20, "female"); calc(page)
        b = result_text(page)
        return ("percentile" in a and "Estimated body fat" not in a and "Estimated body fat" in b and "percentile" not in b, f"19: {a!r} | 20: {b!r}")
    check("AC8 UI age 19 -> teen card; age 20 -> adult card", age_route_ui)

    def ac7_ui():
        clear_form(page); fill_metric(page, 170, 101.2, 16, "male"); calc(page)  # BMI ~35.0
        t = result_text(page)
        return ("Obesity (severe)" in t, t)
    check("AC7 UI teen BMI ~35 shows 'Obesity (severe)'", ac7_ui)

    # =================== AC9 ===================
    ERR_IDS = {"height": "#height-error", "weight": "#weight-error", "age": "#age-error", "sex": "#sex-error"}

    def invalid_case(label, fill, field, msg_re, units="metric"):
        def run():
            clear_form(page)
            # start from a previous valid result to prove it is removed
            fill_metric(page, 175, 70, 30, "male"); calc(page)
            assert "BMI" in result_text(page), "precondition: result visible"
            if units == "imperial":
                set_units(page, "imperial")
            fill(page)
            calc(page)
            err = page.locator(ERR_IDS[field])
            vis = err.is_visible()
            txt = err.inner_text() if vis else ""
            res = result_text(page)
            msg_ok = bool(re.search(msg_re, txt, re.I))
            if field == "sex":
                inv = page.locator("#sex-group").get_attribute("aria-invalid") == "true"
                active = page.evaluate("document.activeElement.id")
                focus_ok = active in ("sex-male", "sex-female")
            else:
                inputs = {"height": ["#height-cm"] if units == "metric" else ["#height-ft", "#height-in"],
                          "weight": ["#weight"], "age": ["#age"]}[field]
                inv = all(page.locator(s).get_attribute("aria-invalid") == "true" for s in inputs)
                active = page.evaluate("document.activeElement.id")
                focus_ok = active == inputs[0].lstrip("#")
            ok = vis and msg_ok and inv and focus_ok and res == "" and "BMI" not in res
            return ok, f"visible={vis} msg={txt!r} aria-invalid={inv} focus={active} result={res!r}"
        check(f"AC9 UI {label}", run)

    AGE_RE = r"age must be.*16.*100"
    # contract change 2026-11-22 review (AC26): age below 16 has its own message (was the generic "Age must be ... 16 to 100")
    invalid_case("age 15 (AC26: under-16 message)", lambda pg: fill_metric(pg, age=15), "age", r"this calculator is for ages 16 and over")
    invalid_case("age 0 (AC26: under-16 message)", lambda pg: fill_metric(pg, age=0), "age", r"this calculator is for ages 16 and over")
    invalid_case("age 101", lambda pg: fill_metric(pg, age=101), "age", AGE_RE)
    invalid_case("age 30.5", lambda pg: fill_metric(pg, age="30.5"), "age", AGE_RE)
    invalid_case("height 90 cm", lambda pg: fill_metric(pg, h=90), "height", r"height must be.*100.*250 cm")
    invalid_case("height 260 cm", lambda pg: fill_metric(pg, h=260), "height", r"height must be.*100.*250 cm")
    invalid_case("weight 25 kg", lambda pg: fill_metric(pg, w=25), "weight", r"weight must be.*30.*300 kg")
    invalid_case("weight 400 kg", lambda pg: fill_metric(pg, w=400), "weight", r"weight must be.*30.*300 kg")
    invalid_case("empty height", lambda pg: fill_metric(pg, h=""), "height", r"enter your height")
    invalid_case("empty weight", lambda pg: fill_metric(pg, w=""), "weight", r"enter your weight")
    invalid_case("empty age", lambda pg: fill_metric(pg, age=""), "age", r"enter your age")
    # AC25: non-blank, non-numeric text -> NOT_A_NUMBER message, never "Enter your ..."
    DIGITS_RE = r"use digits only, e\.g\. 70\.5"
    invalid_case("AC25 weight '70,5' -> Use digits only", lambda pg: fill_metric(pg, w="70,5"), "weight", DIGITS_RE)
    invalid_case("AC25 weight '70kg' -> Use digits only", lambda pg: fill_metric(pg, w="70kg"), "weight", DIGITS_RE)
    invalid_case("AC25 age 'abc' -> Use digits only", lambda pg: fill_metric(pg, age="abc"), "age", DIGITS_RE)
    invalid_case("AC25 height 'abc' -> Use digits only", lambda pg: fill_metric(pg, h="abc"), "height", DIGITS_RE)
    invalid_case("AC25 imperial feet 'abc' -> Use digits only", lambda pg: pg.get_by_label("Feet (ft)").fill("abc"), "height", DIGITS_RE, "imperial")
    invalid_case("imperial inches 12", lambda pg: pg.get_by_label("Inches (in)").fill("12"), "height", r"height must be.*ft", "imperial")
    invalid_case("imperial inches -1", lambda pg: pg.get_by_label("Inches (in)").fill("-1"), "height", r"height must be.*ft", "imperial")

    def no_sex():
        clear_form(page); fill_metric(page, 175, 70, 30); calc(page)
        vis = page.locator("#sex-error").is_visible()
        txt = page.locator("#sex-error").inner_text() if vis else ""
        inv = page.locator("#sex-group").get_attribute("aria-invalid") == "true"
        active = page.evaluate("document.activeElement.id")
        return (vis and re.search(r"choose male or female", txt, re.I) and inv and active == "sex-male" and result_text(page) == "",
                f"msg={txt!r} group-aria-invalid={inv} focus={active}")
    check("AC9 UI no sex selected", no_sex)

    def all_empty():
        clear_form(page); calc(page)
        vis = [page.locator(s).is_visible() for s in ERR_IDS.values()]
        active = page.evaluate("document.activeElement.id")
        return (all(vis) and active == "height-cm" and result_text(page) == "", f"visible={vis} focus={active}")
    check("AC9 UI all fields empty: 4 messages, focus on first (height), no result", all_empty)

    def error_clears_on_edit():
        clear_form(page); fill_metric(page, 175, 70, 15, "male"); calc(page)
        page.get_by_label("Age (years)").fill("16")
        gone = not page.locator("#age-error").is_visible() and page.locator("#age").get_attribute("aria-invalid") is None
        calc(page)
        return (gone and "BMI" in result_text(page) and not page.locator("#age-error").is_visible(), "")
    check("AC9b UI fixing a field clears its error; valid resubmit shows result", error_clears_on_edit)

    def enter_submits():
        clear_form(page); fill_metric(page, 175, 70, 30, "male")
        page.get_by_label("Age (years)").press("Enter")
        return ("BMI" in result_text(page), "")
    check("AC9c Enter in a field submits", enter_submits)

    def no_live_calc():
        clear_form(page); fill_metric(page, 175, 70, 30, "male")
        return (result_text(page) == "", "result appeared before Calculate")
    check("Spec: no live calculation while typing", no_live_calc)

    # =================== AC17 ===================
    def bf_ui(h, w, age, sex, label):
        def run():
            clear_form(page); fill_metric(page, h, w, age, sex); calc(page)
            t = result_text(page)
            m = re.search(r"Estimated body fat: about ([\d.]+)%", t)
            r = re.search(r"Formulas ranged ([\d.]+)–([\d.]+)%", t)
            if not m or not r:
                return False, t
            vals = [float(m.group(1)), float(r.group(1)), float(r.group(2))]
            ok_ = all(0 <= v <= 100 for v in vals) and vals[1] <= vals[0] <= vals[2]
            return ok_, f"avg/min/max shown = {vals}"
        check(label, run)
    bf_ui(200, 40, 20, "male", "AC17 UI male 20, 200cm, 40kg (BMI 10.0): body fat, average and range within 0-100%")
    bf_ui(150, 180, 100, "female", "AC17 UI female 100, 150cm, 180kg (BMI 80.0): body fat, average and range within 0-100%")

    # =================== AC18 ===================
    COMBO = "Please check your height and weight — this combination isn't realistic."

    def combo_case(h, w, label):
        def run():
            clear_form(page); fill_metric(page, h, w, 30, "male"); calc(page)
            fe = page.locator("#form-error")
            vis = fe.is_visible(); txt = fe.inner_text() if vis else ""
            inv = page.locator("#height-cm").get_attribute("aria-invalid") == "true"
            focus = page.evaluate("document.activeElement.id")
            ok_ = (vis and COMBO in txt and inv and focus == "height-cm" and result_text(page) == ""
                   and not page.locator("#height-error").is_visible() and not page.locator("#weight-error").is_visible())
            # form-error sits above the Calculate button
            fb = fe.bounding_box() if vis else None
            bb = page.get_by_role("button", name="Calculate").bounding_box()
            above = bool(fb and fb["y"] + fb["height"] <= bb["y"] + 1)
            return ok_ and above, f"visible={vis} msg={txt!r} aria-invalid={inv} focus={focus} above-button={above} result={result_text(page)!r}"
        check(label, run)
    combo_case(250, 30, "AC18 UI 250cm/30kg: combination message in #form-error, no result, focus on height")
    combo_case(100, 300, "AC18 UI 100cm/300kg: combination message in #form-error, no result, focus on height")

    def combo_accept():
        out = []
        for h, w, want in [(200, 40, "10.0"), (150, 180, "80.0")]:
            clear_form(page); fill_metric(page, h, w, 30, "female"); calc(page)
            if want not in result_text(page) or page.locator("#form-error").is_visible():
                out.append(f"{h}/{w}: {result_text(page)!r}")
        return (not out, "; ".join(out))
    check("AC18 UI BMI exactly 10.0 and 80.0 accepted", combo_accept)

    def combo_clear():
        clear_form(page); fill_metric(page, 250, 30, 30, "male"); calc(page)
        page.get_by_label("Weight (kg)").fill("70")
        gone = not page.locator("#form-error").is_visible() and page.locator("#height-cm").get_attribute("aria-invalid") is None
        calc(page)
        return (gone and "BMI" in result_text(page), "")
    check("AC18b UI editing weight clears the combination error; resubmit works", combo_clear)

    def combo_imperial():
        clear_form(page); set_units(page, "imperial")
        # contract change 2026-11-22 review: 3 ft 3 in (99.1 cm) is now out of range itself; the implausible-combination case uses 3 ft 4 in
        page.get_by_label("Feet (ft)").fill("3"); page.get_by_label("Inches (in)").fill("4")
        page.get_by_label("Weight (lb)").fill("660"); page.get_by_label("Age (years)").fill("30")
        page.get_by_label("Male", exact=True).check(); calc(page)
        vis = page.locator("#form-error").is_visible()
        return (vis and COMBO in page.locator("#form-error").inner_text() and result_text(page) == "" and page.evaluate("document.activeElement.id") == "height-ft", "")
    check("AC18c UI imperial implausible combination (3 ft 4 in, 660 lb) -> message, focus on feet", combo_imperial)

    # =================== AC19 ===================
    def imp_case(ft, inch, lb, expect_err, label, msg_re=None, field="height"):
        def run():
            clear_form(page); set_units(page, "imperial")
            page.get_by_label("Feet (ft)").fill(ft); page.get_by_label("Inches (in)").fill(inch)
            page.get_by_label("Weight (lb)").fill(lb); page.get_by_label("Age (years)").fill("30")
            page.get_by_label("Male", exact=True).check(); calc(page)
            err = page.locator(f"#{field}-error")
            if expect_err:
                txt = err.inner_text() if err.is_visible() else ""
                return (bool(txt) and result_text(page) == "" and (msg_re is None or bool(re.search(msg_re, txt, re.I))), f"msg={txt!r} result={result_text(page)!r}")
            return ("BMI" in result_text(page) and not err.is_visible() and not page.locator("#form-error").is_visible(), f"result={result_text(page)!r}")
        check(label, run)
    # contract change 2026-11-22 review (AC19 revised): limits derive from metric. 3 ft 3 in and 66 lb now REJECTED;
    # messages read "3 ft 4 in to 8 ft 2 in" and "67 to 661 lb"; 8 ft 2.1 in and 660.1 lb are now inside the limits.
    imp_case("5.11", "", "150", True, "AC19 UI feet 5.11 rejected with 'whole number' message", r"feet must be a whole number")
    imp_case("3", "3", "100", True, "AC19 UI 3 ft 3 in rejected (contract change 2026-11-22 review)", r"3 ft 4 in to 8 ft 2 in", "height")
    imp_case("5", "8", "66", True, "AC19 UI 66 lb rejected; message states 67 to 661 lb (contract change 2026-11-22 review)", r"67 to 661 lb", "weight")
    imp_case("5", "8", "65.9", True, "AC19 UI 65.9 lb rejected; message states 67 to 661 lb (contract change 2026-11-22 review)", r"67 to 661 lb", "weight")
    imp_case("3", "2.9", "100", True, "AC19 UI 3 ft 2.9 in rejected; message states 3 ft 4 in to 8 ft 2 in (contract change 2026-11-22 review)", r"3 ft 4 in to 8 ft 2 in", "height")
    imp_case("9", "0", "200", True, "AC19 UI 9 ft 0 in rejected; message states 3 ft 4 in to 8 ft 2 in", r"3 ft 4 in to 8 ft 2 in", "height")
    imp_case("8", "2.5", "200", True, "AC19 UI 8 ft 2.5 in rejected (250.2 cm); message states 3 ft 4 in to 8 ft 2 in", r"3 ft 4 in to 8 ft 2 in", "height")
    imp_case("5", "8", "661.5", True, "AC19 UI 661.5 lb rejected (300.1 kg); message states 67 to 661 lb (contract change 2026-11-22 review)", r"67 to 661 lb", "weight")
    imp_case("3", "4", "100", False, "AC19 UI 3 ft 4 in accepted")
    imp_case("5", "8", "67", False, "AC19 UI 67 lb accepted")
    imp_case("8", "2", "200", False, "AC19 UI 8 ft 2 in accepted")
    imp_case("8", "2", "661", False, "AC19 UI 8 ft 2 in with 661 lb accepted")
    imp_case("8", "2.1", "200", False, "AC19 UI 8 ft 2.1 in accepted (249.2 cm; contract change 2026-11-22 review)")

    # =================== AC20 ===================
    def stale(label, action):
        def run():
            clear_form(page); fill_metric(page, 175, 70, 30, "male"); calc(page)
            if "BMI" not in result_text(page):
                return False, "precondition: no result"
            action()
            hidden = result_text(page) == "" and page.locator("#bmi-result *").count() == 0
            calc(page)
            again = "BMI" in result_text(page)
            return hidden and again, f"hidden-after-action={hidden} shown-after-Calculate={again}"
        check(label, run)
    stale("AC20 UI editing height hides the result", lambda: page.get_by_label("Height (cm)").fill("176"))
    stale("AC20 UI editing weight hides the result", lambda: page.get_by_label("Weight (kg)").fill("71"))
    stale("AC20 UI editing age hides the result", lambda: page.get_by_label("Age (years)").fill("31"))
    stale("AC20 UI changing sex hides the result", lambda: page.get_by_label("Female", exact=True).check())
    stale("AC20 UI switching units hides the result", lambda: set_units(page, "imperial"))
    stale("AC20 UI typing a keystroke (append char) hides the result", lambda: page.get_by_label("Age (years)").press_sequentially("0"))

    def stale_imperial():
        clear_form(page); set_units(page, "imperial")
        page.get_by_label("Feet (ft)").fill("5"); page.get_by_label("Inches (in)").fill("8")
        page.get_by_label("Weight (lb)").fill("150"); page.get_by_label("Age (years)").fill("30")
        page.get_by_label("Male", exact=True).check(); calc(page)
        res = []
        for lbl, v in [("Feet (ft)", "6"), ("Inches (in)", "1"), ("Weight (lb)", "160")]:
            calc(page); res.append("BMI" in result_text(page))
            page.get_by_label(lbl).fill(v); res.append(result_text(page) == "")
        set_units(page, "metric"); res.append(result_text(page) == "")
        return (all(res), str(res))
    check("AC20 UI imperial fields (ft, in, lb) and switching back each hide the result", stale_imperial)

    def not_stale_on_focus():
        clear_form(page); fill_metric(page, 175, 70, 30, "male"); calc(page)
        page.get_by_label("Age (years)").focus(); page.keyboard.press("Tab"); page.get_by_role("button", name="Calculate").focus()
        kept = "BMI" in result_text(page)
        calc(page); calc(page)
        return (kept and "BMI" in result_text(page), "")
    check("AC20b UI focusing/tabbing and re-pressing Calculate does NOT hide a current result", not_stale_on_focus)

    # =================== AC21 ===================
    def ac21():
        outs = []
        for w in ("80.5", "80.6"):
            clear_form(page); fill_metric(page, 170, w, 16, "male"); calc(page)
            outs.append(result_text(page))
        return (outs[0] == outs[1] and "27.9" in outs[0] and "percentile" in outs[0], f"{outs[0]!r} vs {outs[1]!r}")
    check("AC21 UI male 16, 170 cm, 80.5 vs 80.6 kg show identical result card", ac21)

    def round1_ui():
        clear_form(page); fill_metric(page, 104, 33.8, 30, "male"); calc(page)
        return ("31.3" in result_text(page), result_text(page))
    check("round1 UI 104 cm / 33.8 kg shows BMI 31.3", round1_ui)

    # =================== AC12 with error ===================
    def ac12c():
        clear_form(page); calc(page)
        return (page.get_by_text(DISCLAIMER, exact=True).is_visible(), "")
    check("AC12c disclaimer visible in error state", ac12c)

    # =================== Review 2026-11-22: AC11 (UI), AC12 card, AC22-AC28, gap closers ===================
    WARN = "this estimate is unreliable"

    def ac12_card():
        out = []
        for h, w, a, sx in [(180, 80, 30, "male"), (175, 70, 17, "male")]:
            clear_form(page); fill_metric(page, h, w, a, sx); calc(page)
            if not page.locator("#bmi-result").get_by_text(CARD_DISCLAIMER, exact=True).is_visible():
                out.append(f"age {a}: {result_text(page)!r}")
        return (not out, "; ".join(out))
    check("AC12d result card (adult and teen) contains 'Screening tool, not medical advice.'", ac12_card)

    def ac12_card_absent_without_result():
        clear_form(page); calc(page)
        return (page.locator("#bmi-result").get_by_text(CARD_DISCLAIMER, exact=True).count() == 0, "")
    check("AC12e no result card (and no card disclaimer) in the error state", ac12_card_absent_without_result)

    def ac11_imperial():
        clear_form(page); set_units(page, "imperial")
        page.get_by_label("Feet (ft)").fill("5"); page.get_by_label("Inches (in)").fill("10.87")   # 180.0 cm
        page.get_by_label("Weight (lb)").fill("170"); page.get_by_label("Age (years)").fill("30")
        page.get_by_label("Male", exact=True).check(); calc(page)
        t = result_text(page)
        return ("131.8–178.2 lb" in t, t)
    check("AC11 UI imperial: 180 cm adult shows healthy range 131.8–178.2 lb", ac11_imperial)

    def ac11_cats():
        out = []
        for w, want in [(59.7, "Underweight"), (59.8, "Healthy weight"), (80.8, "Healthy weight"), (80.9, "Overweight")]:
            clear_form(page); fill_metric(page, 180, w, 30, "male"); calc(page)
            got = sr_summary(page)[1]
            if got != want:
                out.append(f"{w} kg: {got!r}")
        return (not out, "; ".join(out))
    check("AC11 UI 180 cm adult: 59.7 Underweight, 59.8/80.8 Healthy, 80.9 Overweight", ac11_cats)

    def ac22(h, w, ft, inch, lb):
        def run():
            clear_form(page); fill_metric(page, h, w, 30, "male")
            set_units(page, "imperial")
            got = (page.get_by_label("Feet (ft)").input_value(), page.get_by_label("Inches (in)").input_value(),
                   page.get_by_label("Weight (lb)").input_value())
            calc(page)
            errs = [page.locator(i).is_visible() for i in ("#height-error", "#weight-error", "#age-error", "#sex-error", "#form-error")]
            ok_ = got == (ft, inch, lb) and "BMI" in result_text(page) and not any(errs)
            return ok_, f"switched to {got}; errors visible={errs}; result={result_text(page)!r}"
        return run
    check("AC22 UI 250 cm / 300 kg -> 8 ft 2.4 in / 661.4 lb, Calculate gives a result", ac22(250, 300, "8", "2.4", "661.4"))
    check("AC22 UI 100 cm / 30 kg -> 3 ft 3.4 in / 66.1 lb, Calculate gives a result", ac22(100, 30, "3", "3.4", "66.1"))

    def ac23():
        clear_form(page); set_units(page, "imperial")
        page.get_by_label("Inches (in)").fill("70")
        set_units(page, "metric")
        cm = page.get_by_label("Height (cm)").input_value()
        if cm != "":
            return False, f"cm field shows {cm!r}, expected empty"
        fill_metric(page, None, 70, 30, "male"); calc(page)
        err = page.locator("#height-error")
        txt = err.inner_text() if err.is_visible() else ""
        return (bool(re.search(r"enter your height", txt, re.I)) and result_text(page) == "", f"msg={txt!r} result={result_text(page)!r}")
    check("AC23 UI imperial blank feet + 70 in -> switch to metric leaves cm empty; Calculate says 'Enter your height'", ac23)

    def ac24_present():
        out = []
        for h, w, a, sx in [(200, 40, 20, "male"), (150, 180, 100, "female")]:
            clear_form(page); fill_metric(page, h, w, a, sx); calc(page)
            if WARN not in result_text(page):
                out.append(f"{sx} {a} {h}/{w}: {result_text(page)!r}")
        return (not out, "; ".join(out))
    check("AC24 UI body-fat warning present at the clamped extremes (male 20/200/40, female 100/150/180)", ac24_present)

    def ac24_text():
        clear_form(page); fill_metric(page, 200, 40, 20, "male"); calc(page)
        want = "At this BMI the formulas fall outside the range they were developed for; this estimate is unreliable."
        return (want in result_text(page), result_text(page))
    check("AC24 UI warning uses the exact spec wording", ac24_text)

    def ac24_absent():
        clear_form(page); fill_metric(page, 180, 80, 30, "male"); calc(page)
        return (WARN not in result_text(page) and "20.4%" in result_text(page), result_text(page))
    check("AC24 UI no warning for AC1 (male 30, 180 cm, 80 kg)", ac24_absent)

    def ac24_grid():
        clear_form(page)
        seen, bad = set(), []
        for sx in ("male", "female"):
            for a in (20, 40, 65, 100):
                for b in (10, 12, 16, 22, 30, 45, 60, 80):
                    h = 200 if b < 14 else 150
                    w = round(b * (h / 100) ** 2, 1)
                    raw = raw_bf(w / (h / 100) ** 2, a, sx)
                    if any(min(abs(v), abs(v - 100)) < 0.05 for v in raw):
                        continue                                   # too close to a clamp edge to judge
                    want = any(v < 0 or v > 100 for v in raw)
                    fill_metric(page, h, w, a, sx); calc(page)
                    got = WARN in result_text(page)
                    seen.add(want)
                    if got != want:
                        bad.append(f"{sx} {a} BMI {b} ({h}/{w}): warning={got} expected={want} raw={[round(v, 1) for v in raw]}")
        return (not bad and seen == {True, False}, f"seen={seen}; " + "; ".join(bad[:5]))
    check("AC24 UI warning shown exactly when a raw formula falls outside 0-100 (oracle grid, 2 sexes x 4 ages x 8 BMIs)", ac24_grid)

    def ac26_other():
        out = []
        for a in ("101", "30.5"):
            clear_form(page); fill_metric(page, 175, 70, a, "male"); calc(page)
            t = page.locator("#age-error").inner_text() if page.locator("#age-error").is_visible() else ""
            if "Age must be a whole number from 16 to 100" not in t or "ages 16 and over" in t:
                out.append(f"{a}: {t!r}")
        return (not out, "; ".join(out))
    check("AC26 UI age 101 and 30.5 keep 'Age must be a whole number from 16 to 100'", ac26_other)

    def combo_aria(units):
        def run():
            clear_form(page)
            if units == "metric":
                fill_metric(page, 100, 300, 30, "male"); ids = ["height-cm", "weight"]
            else:
                set_units(page, "imperial")
                page.get_by_label("Feet (ft)").fill("3"); page.get_by_label("Inches (in)").fill("4")
                page.get_by_label("Weight (lb)").fill("660"); page.get_by_label("Age (years)").fill("30")
                page.get_by_label("Male", exact=True).check(); ids = ["height-ft", "height-in", "weight"]
            calc(page)
            out = []
            for i in ids:
                inv = page.locator("#" + i).get_attribute("aria-invalid")
                d = page.locator("#" + i).get_attribute("aria-describedby")
                msg = page.evaluate("(id) => { const e = id && document.getElementById(id); return e ? e.textContent : null; }", d)
                if inv != "true" or not msg or COMBO not in msg:
                    out.append(f"{i}: aria-invalid={inv} describedby={d} target-text={msg!r}")
            return (not out, "; ".join(out))
        return run
    check("AC27 UI combination error (100 cm / 300 kg): height and weight aria-invalid=true, aria-describedby -> combination message", combo_aria("metric"))
    check("AC27 UI imperial combination error (3 ft 4 in / 660 lb): ft, in and weight aria-invalid + describedby -> message", combo_aria("imperial"))

    def ac28():
        out = []
        clear_form(page); fill_metric(page, None, 70, 15); calc(page)
        t = error_summary(page)
        if t != "3 fields need attention: height, age, sex":
            out.append(f"3 errors: {t!r}")
        clear_form(page); calc(page)
        t = error_summary(page)
        if t != "4 fields need attention: height, weight, age, sex":
            out.append(f"4 errors: {t!r}")
        clear_form(page); fill_metric(page, 175, 70, 15, "male"); calc(page)
        t = error_summary(page) or ""
        if "age" not in t or any(n in t for n in ("height", "weight", "sex")):
            out.append(f"1 error: {t!r}")
        return (not out, "; ".join(out))
    check("AC28 UI error summary in a live region names every field with an error ('3 fields need attention: height, age, sex')", ac28)

    # ---- gap closers ----
    def severe_p95():
        out = []
        clear_form(page); fill_metric(page, 170, 98, 16, "male"); calc(page)     # BMI 33.9 < 35 but >= 1.2 x P95 (33.46)
        bmi_txt, cat = sr_summary(page)
        if bmi_txt != "33.9" or cat != "Obesity (severe)":
            out.append(f"98 kg: bmi={bmi_txt} cat={cat!r}")
        clear_form(page); fill_metric(page, 170, 96, 16, "male"); calc(page)     # BMI 33.2 < 33.46
        bmi_txt, cat = sr_summary(page)
        if bmi_txt != "33.2" or cat != "Obesity":
            out.append(f"96 kg: bmi={bmi_txt} cat={cat!r}")
        return (not out, "; ".join(out))
    check("AC7 UI severe via 1.2 x P95: male 16, 170 cm, 98 kg (BMI 33.9) severe; 96 kg (33.2) plain Obesity", severe_p95)

    def pct_text():
        out = []
        # expected values computed from the CDC CSV with an independent high-precision oracle (see bmi.test.js)
        for h, w, a, sx, want in [(175, 70, 17, "male", "66th percentile for age and sex (CDC)"),
                                  (165, 60, 18, "female", "57th percentile for age and sex (CDC)"),
                                  (170, 120, 16, "female", ">99th percentile for age and sex (CDC)")]:
            clear_form(page); fill_metric(page, h, w, a, sx); calc(page)
            if want not in result_text(page):
                out.append(f"{sx} {a} {h}/{w}: {result_text(page)!r}")
        return (not out, "; ".join(out))
    check("AC6 UI exact teen percentile text from the CDC oracle (66th, 57th, >99th)", pct_text)

    def abc_switch():
        clear_form(page); fill_metric(page, "abc", 70, 30, "male"); calc(page)
        if not page.locator("#height-error").is_visible():
            return False, "precondition: error not shown for 'abc'"
        set_units(page, "imperial")
        ft = page.get_by_label("Feet (ft)").input_value(); inch = page.get_by_label("Inches (in)").input_value()
        stale = [i for i in ("#height-error", "#weight-error", "#age-error", "#sex-error", "#form-error") if page.locator(i).is_visible()]
        inv = page.locator("#height-ft").get_attribute("aria-invalid")
        set_units(page, "metric")
        back = page.get_by_label("Height (cm)").input_value()
        return (ft == "abc" and inch == "" and not stale and inv is None and back == "abc",
                f"ft={ft!r} in={inch!r} stale-errors={stale} aria-invalid={inv} back={back!r}")
    check("UI typed 'abc' in height survives a unit switch (both ways) and leaves no stale error", abc_switch)
    page.close()

    # =================== AC13 responsive ===================
    for w in (320, 375, 1280):
        pg = new_page(browser, w)

        def states(pg=pg, w=w):
            out = []
            def snap(label):
                sw = no_hscroll(pg)
                sc = small_controls(pg)
                if sw[0] > sw[1] or sw[2] > sw[3]:
                    out.append(f"{label}: h-scroll {sw}")
                if sc:
                    out.append(f"{label}: small {sc}")
            snap("initial")
            calc(pg); snap("error")
            fill_metric(pg, 175, 70, 30, "male"); calc(pg); snap("adult-result")
            fill_metric(pg, age=17); calc(pg); snap("teen-result")
            set_units(pg, "imperial"); snap("imperial")
            pg.get_by_label("Weight (lb)").fill("660"); calc(pg); snap("combo-error")
            pg.get_by_label("Age (years)").fill("101"); calc(pg); snap("imperial-error")
            pg.locator("summary").click(); snap("about-open")
            return (not out, "; ".join(out))
        check(f"AC13 {w}px: no horizontal scroll, all controls >= 44px (7 states)", states)

        if w == 1280:
            def desk(pg=pg):
                set_units(pg, "metric"); fill_metric(pg, 175, 70, 30, "male"); calc(pg)
                return ("22.9" in result_text(pg), result_text(pg))
            check("AC13 1280px desktop works end to end", desk)
        pg.close()

    # screenshots at 375
    pg = new_page(browser, 375, 900)
    fill_metric(pg, 180, 80, 30, "male"); calc(pg)
    pg.screenshot(path=str(SHOTS / "adult_result_375.png"), full_page=True)
    pg.reload(); fill_metric(pg, 175, 70, 17, "male"); calc(pg)
    pg.screenshot(path=str(SHOTS / "teen_result_375.png"), full_page=True)
    pg.reload(); fill_metric(pg, 90, 25, 15); calc(pg)
    pg.screenshot(path=str(SHOTS / "error_state_375.png"), full_page=True)
    record("Screenshots saved (adult, teen, error @375px)", all((SHOTS / f).exists() for f in
           ("adult_result_375.png", "teen_result_375.png", "error_state_375.png")), str(SHOTS))
    pg.close()

    # =================== AC14 keyboard only ===================
    pg = new_page(browser, 375, 900)

    def ac14():
        log, problems = [], []

        def stop(expect_id):
            r = ring_info(pg)
            log.append(r["id"] if r else None)
            if not r:
                problems.append("no focus"); return
            if expect_id and r["id"] != expect_id:
                problems.append(f"expected focus {expect_id}, got {r['id']}")
            if r["style"] == "none" or r["width"] < 2 or not r["focusVisible"]:
                problems.append(f"no visible ring on {r['id']}: {r}")

        kb = pg.keyboard
        kb.press("Tab"); stop("units-metric")
        kb.press("ArrowRight")                       # switch to imperial by keyboard
        if not pg.locator("#units-imperial").is_checked():
            problems.append("ArrowRight did not select Imperial")
        stop("units-imperial")
        kb.press("Tab"); stop("height-ft"); kb.type("5")
        kb.press("Tab"); stop("height-in"); kb.type("11")
        kb.press("Tab"); stop("weight"); kb.type("176.4")
        kb.press("Tab"); stop("age"); kb.type("30")
        kb.press("Tab"); stop("sex-male"); kb.press("Space")
        if not pg.locator("#sex-male").is_checked():
            problems.append("Space did not select Male")
        kb.press("Tab"); stop(None)
        active = pg.evaluate("document.activeElement.textContent.trim()")
        if active != "Calculate":
            problems.append("submit button not reached, at " + active)
        kb.press("Enter")
        t = result_text(pg)
        if "24.6" not in t:
            problems.append("Enter on Calculate did not produce BMI 24.6: " + t)
        pg.screenshot(path=str(SHOTS / "keyboard_focus_ring_375.png"))
        return (not problems, f"stops={log}; " + "; ".join(problems))
    check("AC14 keyboard-only: fill all, switch units, choose sex, submit; visible focus ring at each stop", ac14)

    def ac14b():  # Enter from a text field + reverse order reaches summary
        pg.reload()
        kb = pg.keyboard
        pg.focus("#height-cm"); kb.type("175"); kb.press("Tab"); kb.type("70"); kb.press("Tab"); kb.type("30")
        kb.press("Tab"); kb.press("ArrowRight")   # sex group: first Tab lands on Male; ArrowRight -> Female
        sel = pg.locator("#sex-female").is_checked() or pg.locator("#sex-male").is_checked()
        kb.press("Enter")
        return (sel and "BMI" in result_text(pg), f"sex-selected={sel}")
    check("AC14b keyboard: sex via arrow keys and Enter submits from the radio", ac14b)

    def ac14c():  # <summary> and Calculate focus ring
        pg.reload(); pg.focus("summary")
        r = ring_info(pg)
        pg.keyboard.press("Enter")
        opened = pg.locator("details").evaluate("d => d.open")
        return (opened and r and r["style"] != "none" and r["width"] >= 2, f"{r} open={opened}")
    check("AC14c keyboard: About summary opens with Enter and shows focus ring", ac14c)
    pg.close()

    # =================== AC15 ===================
    pg = new_page(browser, 375)

    def ac15_labels():
        miss = []
        for lbl in ["Height (cm)", "Weight (kg)", "Age (years)"]:
            loc = pg.get_by_label(lbl, exact=True)
            if loc.count() != 1 or not loc.is_visible():
                miss.append(lbl)
        for name in ["Male", "Female"]:
            if not pg.get_by_label(name, exact=True).count():
                miss.append(name)
        for rx in [r"Metric", r"Imperial"]:
            if not pg.get_by_label(re.compile(rx)).count():
                miss.append(rx)
        if not pg.get_by_role("group", name=re.compile("Sex")).count():
            miss.append("group Sex")
        if not pg.get_by_role("group", name="Units").count():
            miss.append("group Units")
        set_units(pg, "imperial")
        for lbl in ["Feet (ft)", "Inches (in)", "Weight (lb)"]:
            if not pg.get_by_label(lbl, exact=True).is_visible():
                miss.append(lbl)
        return (not miss, f"missing {miss}")
    check("AC15a every input has a visible, programmatically associated label (metric + imperial)", ac15_labels)

    def ac15_live():
        pg.reload()
        live = pg.locator("#bmi-result")
        attr = live.get_attribute("aria-live")
        present_before = live.count() == 1 and live.is_visible() is not None
        fill_metric(pg, 175, 70, 30, "male")
        # mutation observer proves the live region content changes in place (what triggers announcements)
        pg.evaluate("""() => { window.__muts = 0; new MutationObserver(m => window.__muts += m.length)
            .observe(document.getElementById('bmi-result'), {childList: true, subtree: true, characterData: true}); }""")
        calc(pg)
        muts = pg.evaluate("window.__muts")
        sr_loc = pg.locator("#bmi-result p", has_text=re.compile(r"^Your BMI is"))
        sr = sr_loc.first.text_content() if sr_loc.count() else ""
        in_a11y_tree = "22.9" in result_text(pg)
        return (attr in ("polite", "assertive") and muts > 0 and in_a11y_tree and "22.9" in sr,
                f"aria-live={attr} mutations={muts} sr-summary={sr!r}")
    check("AC15b result region is aria-live, persistent, updated in place, has screen-reader summary", ac15_live)

    def ac15_err():
        pg.reload(); calc(pg)
        d = pg.locator("#age").get_attribute("aria-describedby")
        return (d == "age-error" and pg.locator("#age").get_attribute("aria-invalid") == "true", f"describedby={d}")
    check("AC15c error messages are associated with fields (aria-describedby/aria-invalid)", ac15_err)

    def ac15_colour_not_alone():
        out = []
        for h, w, label in [(175, 50, "Underweight"), (175, 70, "Healthy weight"), (175, 85, "Overweight"), (175, 110, "Obesity")]:
            pg.reload(); fill_metric(pg, h, w, 30, "male"); calc(pg)
            if label not in result_text(pg):
                out.append(label)
        return (not out, f"label text missing for {out}")
    def ac15_hidden():
        pg.reload(); fill_metric(pg, 175, 70, 30, "male"); calc(pg)
        hidden_ok = pg.evaluate("""() => {
          const ps = [...document.querySelectorAll('#bmi-result p')];
          const sr = ps.find(p => p.textContent.startsWith('Your BMI is'));
          const dupes = ps.filter(p => ['Your BMI', '22.9', 'Healthy weight'].includes(p.textContent.trim()));
          return !!sr && !sr.closest('[aria-hidden=true]') && dupes.length === 3 &&
                 dupes.every(d => d.getAttribute('aria-hidden') === 'true');
        }""")
        return (hidden_ok, "")
    check("AC15e screen-reader summary is exposed; the visual duplicates (BMI, number, category) are aria-hidden", ac15_hidden)
    check("AC15d category always shown as text (not colour alone) for all four adult categories", ac15_colour_not_alone)

    # final error check 2026-11-22: huge pasted numbers must not leak NaN/Infinity/exponent text into fields on unit switch
    def fec_huge_switch():
        pg.reload()
        pg.get_by_label("Height (cm)").fill("9" * 400)
        pg.get_by_label("Weight (kg)").fill("9" * 400)
        set_units(pg, "imperial")
        vals = [pg.get_by_label("Feet (ft)").input_value(), pg.get_by_label("Inches (in)").input_value(),
                pg.get_by_label("Weight (lb)").input_value()]
        bad = [v for v in vals if re.search(r"NaN|Infinity|e\+", v)]
        return (not bad, f"fields after switch: {vals}")
    check("final error check 2026-11-22: unit switch with 400-digit values leaves no NaN/Infinity in fields", fec_huge_switch)
    pg.close()

    browser.close()

    # =================== AC16 (everything exercised above) ===================
    non_file = [u for u in requests_seen if not u.startswith("file://")]
    record("AC16a no console errors / page errors across all flows", not console_errors, "; ".join(console_errors[:5]))
    record("AC16b no non-file network requests across all flows", not non_file,
           f"{len(requests_seen)} requests seen; offenders: {non_file[:5]}")

fails = [r for r in results if not r[1]]
print(f"\n{len(results) - len(fails)}/{len(results)} passed")
sys.exit(1 if fails else 0)
