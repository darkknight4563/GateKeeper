"""Line-number label parser. Formats are pluggable: add a regex per operator/project numbering spec.

Formats included (derived from the public DEXPI examples, confirm against the customer's numbering spec):
  dexpi_ref : "MNc 47126 75HB13 50"  /  "MNc 47127 75HB13 50 Q 80"
              fluid code, line number, piping class, DN, optional insulation code + thickness
  equinor   : "D-13L37007A-0200PB-FS720-0F000N"
              area, line number, DN (4 digits), fluid code, piping class, insulation code, insulation thickness, heat tracing
"""
import re

FORMATS = {
    "equinor": re.compile(
        r"^(?P<area>[A-Z0-9]{1,3})-(?P<line_number>\d{2}[A-Z]\d{5}[A-Z]?)-(?P<dn>\d{4})(?P<fluid_code>[A-Z]{2})"
        r"-(?P<piping_class>[A-Z0-9]{4,6})-(?P<insulation>[0-9A-Z]{2})(?P<insulation_thk>\d{3})(?P<heat_tracing>[A-Z])$"),
    # BASF example: "2750.001.6-0N-2170.8503-150/10HB25T10B1-B40-"
    #   line number, 0N (insulation/tracing code), medium code, DN / piping class, B40 (unknown, kept as suffix)
    "basf": re.compile(
        r"^(?P<line_number>\d{4}\.\d{3}\.\d+)-(?P<insulation>[0-9A-Z]{2})-(?P<fluid_code>\d{4}\.\d{4})"
        r"-(?P<dn>\d{1,4})/(?P<piping_class>[A-Z0-9]+)(?:-(?P<suffix>[A-Z0-9]+))?-?$"),
    "dexpi_ref": re.compile(
        r"^(?P<fluid_code>[A-Z][A-Za-z]{1,3})\s+(?P<line_number>\d{4,6})\s+(?P<piping_class>[0-9]{2}[A-Z]{2}[0-9]{2})"
        r"\s+(?P<dn>\d{1,4})(?:\s+(?P<insulation>[A-Z])\s+(?P<insulation_thk>\d+))?$"),
}


def parse_line_label(text):
    """Return dict with format name and fields, or None if the label matches no known format."""
    t = " ".join(str(text).split())
    for name, rx in FORMATS.items():
        m = rx.match(t)
        if m:
            d = {k: v for k, v in m.groupdict().items() if v is not None}
            d["dn"] = str(int(d["dn"]))
            d["format"] = name
            return d
    return None


if __name__ == "__main__":
    tests = {
        "D-13L37007A-0200PB-FS720-0F000N": ("13L37007A", "200", "FS720"),
        "D-13L37014A-0200PB-FD120-0F000N": ("13L37014A", "200", "FD120"),
        "D-43L37007A-0800VF-AS7F0-0F000N": ("43L37007A", "800", "AS7F0"),
        "MNc 47126 75HB13 50": ("47126", "50", "75HB13"),
        "MNc 47127 75HB13 50 Q 80": ("47127", "50", "75HB13"),
        "MNc 47125 73HG12 25": ("47125", "25", "73HG12"),
        "QSb 47141 75HB13 50 Q 80": ("47141", "50", "75HB13"),
        "2750.001.6-0N-2170.8503-150/10HB25T10B1-B40-": ("2750.001.6", "150", "10HB25T10B1"),
    }
    ok = True
    for s, exp in tests.items():
        r = parse_line_label(s)
        got = (r["line_number"], r["dn"], r["piping_class"]) if r else None
        ok &= got == exp
        print("PASS" if got == exp else "FAIL", s, "->", r)
    assert parse_line_label("73KH12-50") is None, "valve label must not parse as a line"
    print("ALL PASS" if ok else "FAILURES")
