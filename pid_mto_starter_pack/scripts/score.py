"""Deterministic scorer: pipeline prediction JSON vs DEXPI-derived ground truth JSON.

usage:
  python3 score.py <ground_truth.json> <prediction.json>            # one drawing
  python3 score.py <ground_truth_dir> <prediction_dir>               # all drawings, matched by file name

Prediction schema (same shape as ground truth; extra keys ignored):
  {"lines":[{"LineNumber":"47126","NominalDiameterNumericalValueRepresentation":"50","PipingClassCode":"75HB13"}],
   "valves":[{"class":"BallValve","dn":"25","piping_class":"75HB13","line":"47126","tag":"73KH12"}],
   "instruments":[{"category":"T","functions":"ICSA","number":"4750.03"}]}

A ground-truth field that is null is a wildcard (not scored). No LLM judge: every metric is exact.
"""
import json, os, sys, unicodedata
from collections import Counter


def norm_dn(v):
    if v is None:
        return None
    s = str(v).upper().replace("DN", "").strip()
    try:
        return str(int(float(s)))
    except ValueError:
        return s or None


def norm(v):
    """NFKC folds superscripts (IS⁺Z⁺A -> IS+Z+A) and full-width characters."""
    if v in (None, ""):
        return None
    return unicodedata.normalize("NFKC", str(v)).strip().upper()


def match(gt_items, pred_items, fields):
    """Greedy one-to-one matching; null GT fields are wildcards. Returns (matched pairs, unmatched gt, unmatched pred)."""
    # auto-accepted predictions claim GT matches first, so a flagged duplicate is never what 'uses up' the match
    pred_left = sorted(pred_items, key=lambda p: p.get("status", "auto") != "auto")
    pairs, gt_left = [], []
    # match most-specified GT items first so wildcards don't steal exact matches
    for g in sorted(gt_items, key=lambda x: -sum(x.get(f) is not None for f in fields)):
        hit = None
        for i, p in enumerate(pred_left):
            if all(g.get(f) is None or g.get(f) == p.get(f) for f in fields):
                hit = i
                break
        if hit is None:
            gt_left.append(g)
        else:
            pairs.append((g, pred_left.pop(hit)))
    return pairs, gt_left, pred_left


def prf(tp, n_gt, n_pred):
    p = tp / n_pred if n_pred else (1.0 if n_gt == 0 else 0.0)
    r = tp / n_gt if n_gt else 1.0
    f = 2 * p * r / (p + r) if (p + r) else 0.0
    return round(p, 3), round(r, 3), round(f, 3)


def valves(d):
    return [{"class": norm(v.get("class")), "dn": norm_dn(v.get("dn")), "piping_class": norm(v.get("piping_class")),
             "line": norm(v.get("line")),
             # a prediction without a status counts as auto-accepted (the conservative assumption)
             "status": str(v.get("status") or "auto").lower()} for v in d.get("valves", [])]


def lines(d):
    return [{"line": norm(l.get("LineNumber")), "dn": norm_dn(l.get("NominalDiameterNumericalValueRepresentation")),
             "piping_class": norm(l.get("PipingClassCode"))} for l in d.get("lines", [])
            if l.get("LineNumber") and not str(l.get("LineNumber")).startswith("*")]


def instruments(d):
    items = [{"cat": norm(i.get("category")), "fn": norm(i.get("functions")), "num": norm(i.get("number"))}
             for i in d.get("instruments", [])]
    return [x for x in items if any(x.values())]  # empty stubs never count, on either side


def score(gt, pred):
    out = {}
    # 1. MTO (what procurement buys): valve class + DN + piping class
    gv, pv = valves(gt), valves(pred)
    pairs, g_miss, p_extra = match(gv, pv, ["class", "dn", "piping_class"])
    out["mto_valve_precision"], out["mto_valve_recall"], out["mto_valve_f1"] = prf(len(pairs), len(gv), len(pv))
    out["pred_valves_total"] = len(pv)
    out["hallucinated_valves"] = len(p_extra)
    # THE go/no-go metric: wrong or invented valves that the verifier let through as status=auto.
    # A misread DN counts here too (it shows up as one missed + one extra item).
    out["unflagged_errors"] = sum(1 for p in p_extra if p["status"] == "auto")
    out["flagged_errors"] = len(p_extra) - out["unflagged_errors"]
    # 2. valve-to-line assignment among MTO-matched valves (only where GT line is a real line number)
    scored = [(g, p) for g, p in pairs if g["line"] and not g["line"].startswith("*")]
    out["valve_line_assignment_acc"] = round(sum(g["line"] == p["line"] for g, p in scored) / len(scored), 3) if scored else None
    # 3. line list
    gl, pl = lines(gt), lines(pred)
    lp, _, _ = match(gl, pl, ["line", "dn", "piping_class"])
    out["line_precision"], out["line_recall"], out["line_f1"] = prf(len(lp), len(gl), len(pl))
    # 4. instrument functions
    gi, pi = instruments(gt), instruments(pred)
    ip, _, _ = match(gi, pi, ["cat", "fn", "num"])
    out["instrument_precision"], out["instrument_recall"], out["instrument_f1"] = prf(len(ip), len(gi), len(pi))
    out["missed_valves"] = [f'{g["class"]} DN{g["dn"]} {g["piping_class"]}' for g in g_miss]
    out["extra_valves"] = [f'{p["class"]} DN{p["dn"]} {p["piping_class"]}' for p in p_extra]
    return out


def aggregate(results):
    keys = ["mto_valve_f1", "line_f1", "instrument_f1", "valve_line_assignment_acc"]
    agg = {}
    for k in keys:
        vals = [r[k] for r in results.values() if r.get(k) is not None]
        agg[k] = round(sum(vals) / len(vals), 3) if vals else None
    for k in ("pred_valves_total", "hallucinated_valves", "unflagged_errors", "flagged_errors"):
        agg[k + "_sum"] = sum(r[k] for r in results.values())
    n = agg["pred_valves_total_sum"]
    agg["unflagged_error_rate"] = round(agg["unflagged_errors_sum"] / n, 4) if n else 0.0
    return agg


if __name__ == "__main__":
    g, p = sys.argv[1], sys.argv[2]
    if os.path.isdir(g):
        res = {}
        for f in sorted(os.listdir(g)):
            if f.endswith(".json"):
                pf = os.path.join(p, f)
                pred = json.load(open(pf)) if os.path.exists(pf) else {}
                res[f] = score(json.load(open(os.path.join(g, f))), pred)
        print(json.dumps({"per_drawing": res, "aggregate": aggregate(res)}, indent=2))
    else:
        print(json.dumps(score(json.load(open(g)), json.load(open(p))), indent=2))
