"""Regression tests for the starter pack. Run: python3 -I tests/test_pack.py  (from the pack root)

These are deliberately NOT circular: line labels below were transcribed by hand from the rendered drawings,
so a bug in build_gt.py cannot hide by agreeing with itself.
"""
import copy, json, os, sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, os.path.join(ROOT, "scripts"))
from score import score, norm_dn  # noqa: E402
from line_parse import parse_line_label  # noqa: E402

GT = {c: json.load(open(os.path.join(ROOT, "ground_truth", c + ".json")))
      for c in ("C01_DEXPI_Reference_PID", "C02_Process_Column_BASF", "C03_Piping_Equinor")}

# hand-transcribed from drawings/*.png
DRAWN_LINES = {
    "C01_DEXPI_Reference_PID": ["MNb 47121 75HB13 80", "MNb 47122 75HB13 80", "MNb 47123 75HB13 80",
                                "MNc 47124 75HB13 80", "MNc 47125 75HB13 50", "MNc 47125 73HG12 25",
                                "MNc 47126 75HB13 50", "MNc 47127 75HB13 50 Q 80", "WKa 47130 75HB13 50",
                                "WKb 47131 75HB13 50", "QSa 47140 75HB13 50 Q 80", "QSb 47141 75HB13 50 Q 80"],
    "C02_Process_Column_BASF": ["2750.001.6-0N-2170.8503-150/10HB25T10B1-B40-"],
    "C03_Piping_Equinor": ["D-13L37014A-0200PB-FD120-0F000N", "D-13L37007A-0200PB-FS720-0F000N",
                           "D-43L37007A-0800VF-AS7F0-0F000N"],
}
FAILS = []


def check(cond, msg):
    print(("PASS " if cond else "FAIL ") + msg)
    if not cond:
        FAILS.append(msg)


def as_pred(gt, status="auto"):
    """What a perfect extractor would emit: the drawing-faithful GT, with wildcards filled in with *something*."""
    p = copy.deepcopy(gt)
    for v in p["valves"]:
        v["status"] = status
        v["class"] = v["class"] or "GateValve"   # GT null = not scored, so any value must still pass
        v["piping_class"] = v["piping_class"] or "XX99"
    return p


# 1. GT lines == hand-transcribed drawing labels
for case, labels in DRAWN_LINES.items():
    want = {(p["line_number"], p["dn"], p["piping_class"]) for p in map(parse_line_label, labels)}
    got = {(l["LineNumber"], norm_dn(l["NominalDiameterNumericalValueRepresentation"]), l["PipingClassCode"])
           for l in GT[case]["lines"]}
    check(want == got, f"{case}: GT lines match the labels printed on the drawing ({len(want)})")

# 2. GT obeys the S5 rules it will be used to test (valve DN <= line DN; class consistent with a drawn label)
for case, gt in GT.items():
    by_line = {}
    for l in gt["lines"]:
        by_line.setdefault(l["LineNumber"], []).append((int(norm_dn(l["NominalDiameterNumericalValueRepresentation"])), l["PipingClassCode"]))
    bad = []
    for v in gt["valves"]:
        if v["line"] and v["dn"]:
            if int(norm_dn(v["dn"])) > max(d for d, _ in by_line[v["line"]]):
                bad.append(f'{v["id"]} DN{v["dn"]} > line {v["line"]}')
            if v["piping_class"] and v["piping_class"] not in {c for _, c in by_line[v["line"]]}:
                bad.append(f'{v["id"]} class {v["piping_class"]} not on line {v["line"]}')
    check(not bad, f"{case}: GT consistent with S5 rules 3 and 5 {bad or ''}")

# 3. no empty instrument stubs, no placeholder lines, ASCII-normalised functions
for case, gt in GT.items():
    check(all(any(i.values()) for i in gt["instruments"]), f"{case}: no empty instrument stubs")
    check(all(not l["LineNumber"].startswith("*") for l in gt["lines"]), f"{case}: no placeholder lines")
check(any(i["functions"] == "IS+Z+A" for i in GT["C02_Process_Column_BASF"]["instruments"]), "C02: IS+Z+A normalised")

# 4. a perfect drawing-faithful extractor passes every acceptance gate
for case, gt in GT.items():
    s = score(gt, as_pred(gt))
    ok = s["mto_valve_f1"] == 1 and s["line_f1"] == 1 and s["instrument_f1"] == 1 and s["unflagged_errors"] == 0
    check(ok, f"{case}: perfect extractor scores 1.0 / 1.0 / 1.0 with 0 unflagged errors")

# 5. superscript in prediction still matches
gt = GT["C02_Process_Column_BASF"]
p = as_pred(gt)
p["instruments"][0]["functions"] = "IS⁺Z⁺A"
check(score(gt, p)["instrument_f1"] == 1, "superscript IS⁺Z⁺A in prediction matches IS+Z+A")

# 6. hallucinated instrument / empty stub is NOT rewarded
gt = GT["C03_Piping_Equinor"]
p = as_pred(gt)
p["instruments"].append({"category": "F", "functions": "IC", "number": "9999"})
p["instruments"].append({"category": None, "functions": None, "number": None})
s = score(gt, p)
check(s["instrument_precision"] == 0.5 and s["instrument_recall"] == 1.0, "hallucinated instrument lowers precision; stub ignored")

# 7. unflagged vs flagged errors
gt = GT["C01_DEXPI_Reference_PID"]
p = as_pred(gt)
i25 = next(i for i, v in enumerate(p["valves"]) if v["dn"] == "25" and v["class"] == "BallValve")
p["valves"][i25]["dn"] = "50"                      # misread DN, auto-accepted
p["valves"].append({"class": "GateValve", "dn": "80", "piping_class": "75HB13", "line": "47121", "status": "needs_review"})
s = score(gt, p)
check(s["unflagged_errors"] == 1 and s["flagged_errors"] == 1, f"misread DN counted unflagged, flagged invention not ({s['unflagged_errors']}/{s['flagged_errors']})")

# 8. order-insensitive: a flagged duplicate listed before the real auto valve is not an unflagged error
gt = GT["C01_DEXPI_Reference_PID"]
p = as_pred(gt)
dup = dict(p["valves"][5]); dup["status"] = "needs_review"
p["valves"].insert(0, dup)
s = score(gt, p)
check(s["unflagged_errors"] == 0 and s["flagged_errors"] == 1, f"flagged duplicate listed first -> 0 unflagged / 1 flagged ({s['unflagged_errors']}/{s['flagged_errors']})")

# 9. dual-size SV: inlet DN scores; "25/50" is a contract violation and must show up as an error
p = as_pred(gt)
sv = next(v for v in p["valves"] if "Safety" in v["class"])
check(score(gt, p)["unflagged_errors"] == 0 and sv["dn"] == "25", "SV 104.01 reported with inlet DN 25 passes")
sv["dn"] = "25/50"
check(score(gt, p)["unflagged_errors"] == 1, "SV 104.01 reported as '25/50' is caught as an unflagged error")

# 10. no unclassed graphic stubs in fixtures
check(all(pi["class"] for g in GT.values() for pi in g["piping_items"]), "no empty-class piping_items")

print("\nALL PASS" if not FAILS else f"\n{len(FAILS)} FAILED")
sys.exit(1 if FAILS else 0)
