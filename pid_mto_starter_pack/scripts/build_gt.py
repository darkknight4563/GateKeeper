"""Build drawing-faithful MTO ground truth from DEXPI Proteus XML.

usage: python3 -I build_gt.py <dir containing DEXPI case folders or .xml files> <out dir>

Rule: a field is scored only if it can be read off the drawing. Anything the XML knows but the drawing
does not show is set to null (a wildcard in score.py) and the reason is written to "scoring_notes".
- lines: one record per line label printed on the drawing (System + Segment labels), parsed with line_parse.py
- valves: class, DN and piping class from the component itself; actuated from DEXPI ActuatingSystem links
- instruments: empty DEXPI stubs are dropped; Unicode is NFKC-normalised (IS⁺Z⁺A -> IS+Z+A)
"""
import glob, json, os, re, sys, unicodedata, xml.etree.ElementTree as ET

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))  # our own scripts dir (not the data dir)
from line_parse import parse_line_label  # noqa: E402

VALVE_WORDS = ("Valve", "Cock")


def nfkc(s):
    return unicodedata.normalize("NFKC", s) if isinstance(s, str) else s


def own_attrs(el):
    d = {}
    for ga in el.iter("GenericAttribute"):
        n, v = ga.get("Name", "").replace("AssignmentClass", ""), ga.get("Value")
        if v and n not in d:
            d[n] = v
    return d


def label_text(lab):
    return " | ".join(t.get("String", "") for t in lab.iter("Text") if t.get("String"))


def safe_name(case):
    return re.sub(r"[^A-Za-z0-9_]+", "", case.replace("/", "__").replace(" ", "_").replace("&", ""))


def build(xml_path):
    root = ET.parse(xml_path).getroot()
    if root.tag != "PlantModel":
        return None
    parent = {c: p for p in root.iter() for c in p}
    notes = []

    # actuated valves = targets of OperatedValveReference
    actuated_ids = set()
    for ref in root.iter():
        if ref.get("ComponentClass") == "OperatedValveReference":
            for a in ref.iter("Association"):
                if a.get("Type") == "refers to":
                    actuated_ids.add(a.get("ItemID"))

    # ---- lines: from printed labels only
    lines, seen = [], set()
    for lab in root.iter("Label"):
        if lab.get("ComponentClass") not in ("PipingNetworkSystemLabel", "PipingNetworkSegmentLabel"):
            continue
        raw = label_text(lab).replace(" | ", " ")
        p = parse_line_label(raw)
        if not p:
            notes.append(f"line label not parsed (add a format to line_parse.py): {raw!r}")
            continue
        key = (p["line_number"], p["dn"], p["piping_class"])
        if key in seen:
            continue
        seen.add(key)
        lines.append({"LineNumber": p["line_number"], "NominalDiameterNumericalValueRepresentation": p["dn"],
                      "PipingClassCode": p["piping_class"], "FluidCode": p.get("fluid_code"),
                      "raw_label": raw, "format": p["format"]})
    drawn = {(l["LineNumber"], l["PipingClassCode"]) for l in lines}
    drawn_line_numbers = {l["LineNumber"] for l in lines}

    def system_of(el):
        while el is not None and el.tag != "PipingNetworkSystem":
            el = parent.get(el)
        return el

    # ---- valves and other piping items
    valves, piping_items = [], []
    for pc in root.iter("PipingComponent"):
        cls = pc.get("ComponentClass") or ""
        a = own_attrs(pc)
        sysel = system_of(pc)
        line = own_attrs(sysel).get("LineNumber") if sysel is not None else None
        if line and line not in drawn_line_numbers:
            notes.append(f"{pc.get('ID')}: line {line!r} not printed on drawing -> line=null")
            line = None
        vlabels = [label_text(l) for l in pc.findall("Label")]
        raw = vlabels[0] if vlabels else None
        seg = pc
        while seg is not None and seg.tag != "PipingNetworkSegment":
            seg = parent.get(seg)
        seg_a = own_attrs(seg) if seg is not None else {}
        sys_a = own_attrs(sysel) if sysel is not None else {}
        dn = a.get("NominalDiameterNumericalValueRepresentation") or seg_a.get("NominalDiameterNumericalValueRepresentation")
        pclass = a.get("PipingClassCode") or seg_a.get("PipingClassCode") or sys_a.get("PipingClassCode")
        # 1) a piping class printed on the valve's own label (e.g. C02 "AS9") is visible -> use it
        printed = [t.strip() for t in (raw or "").split("|") if re.fullmatch(r"[A-Z]{2}\d{1,2}", t.strip())]
        if printed:
            pclass = printed[0]
        # 2) otherwise the reader infers it from the line label; if that (line, class) pair is not printed -> wildcard
        elif pclass and (line is None or (line, pclass) not in drawn):
            notes.append(f"{pc.get('ID')}: piping class {pclass} not readable from drawing for line {line} -> piping_class=null")
            pclass = None
        item = {"id": pc.get("ID"), "class": cls, "dn": dn, "piping_class": pclass, "line": line,
                "tag": a.get("PipingComponentName") or a.get("SubTagName"), "raw_label": raw,
                "actuated": pc.get("ID") in actuated_ids}
        if any(w in cls for w in VALVE_WORDS):
            if cls == "OperatedValve" and not item["actuated"]:
                notes.append(f"{pc.get('ID')}: DEXPI 'OperatedValve' drawn as a generic valve with no actuator -> class=null")
                item["class"] = None
            valves.append(item)
        elif cls and cls not in ("PipeFitting", "PipeOffPageConnector"):  # skip unclassed graphic shapes
            piping_items.append(item)

    # ---- instruments (drop empty stubs)
    instruments = []
    for pif in root.iter("ProcessInstrumentationFunction"):
        a = own_attrs(pif)
        i = {"category": nfkc(a.get("ProcessInstrumentationFunctionCategory")),
             "functions": nfkc(a.get("ProcessInstrumentationFunctions")),
             "number": nfkc(a.get("ProcessInstrumentationFunctionNumber"))}
        if any(i.values()):
            instruments.append(i)

    equipment = []
    for eq in root.findall(".//Equipment"):
        a = {k: v for k, v in ((g.get("Name", "").replace("AssignmentClass", ""), g.get("Value"))
                               for g in eq.findall("./GenericAttributes/GenericAttribute")) if v}
        equipment.append({"class": eq.get("ComponentClass"), "tag": a.get("TagName")})

    return {"lines": lines, "valves": valves, "piping_items": piping_items,
            "instruments": instruments, "equipment": equipment, "scoring_notes": notes}


if __name__ == "__main__":
    src, out = sys.argv[1], sys.argv[2]
    os.makedirs(out, exist_ok=True)
    xmls = sorted(set(glob.glob(os.path.join(src, "*.xml")) + glob.glob(os.path.join(src, "**", "*.xml"), recursive=True)))
    for x in xmls:
        try:
            gt = build(x)
        except ET.ParseError:
            continue
        if gt is None:
            continue
        rel = os.path.relpath(x, src)
        case = os.path.dirname(rel) or os.path.splitext(rel)[0]
        gt = {"case": case, "source_xml": rel, **gt}
        fn = safe_name(case) + ".json"
        json.dump(gt, open(os.path.join(out, fn), "w"), indent=2, ensure_ascii=False)
        print(f"{fn:45} lines={len(gt['lines']):2} valves={len(gt['valves']):2} instr={len(gt['instruments']):2} notes={len(gt['scoring_notes'])}")
