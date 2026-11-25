# Build spec: P&ID → MTO module for Gatekeeper AI

**Owner:** Ali Emadi · **Status:** 2-week validation prototype · **Branch:** `feature/pid-mto`

## 0. Read this first (instructions for the coding agent)

1. **Stop point before any code:** read the Gatekeeper repository and write `docs/pid-mto-integration-plan.md`. It must cover: (a) the existing procurement item/line-item tables and Pydantic models, (b) the coordinator agent's interface for adding a step or specialist, (c) the existing eval harness, and (d) exactly which files you will add and which existing files you will modify. **Wait for Ali's approval before writing code.**
2. Do not change existing database tables or API contracts. Add new tables and endpoints only. If an existing schema must change, propose it in the plan and stop.
3. Only use data in `pid_mto_starter_pack/` and data you generate from it. Never commit customer or employer drawings, and never write them into test fixtures.
4. Keep the model provider configurable (`PID_VISION_MODEL` env var). The default is whatever vision-capable model Gatekeeper already calls. Log tokens and cost for every call.
5. Every number in the demo must come from `scripts/score.py`. Report no accuracy figure that the scorer did not produce.
6. **Repo reality check (added after inspecting `darkknight4563/GateKeeper`):** the backend is **Supabase** (Postgres + Deno/TypeScript edge functions under `supabase/functions/`, SQL under `supabase/migrations/`) with a React/Vite frontend. It is **not** FastAPI. Wherever this spec says FastAPI or "new tables", map it onto Supabase in the integration plan: tables become migrations, and endpoints become edge functions or a small Python worker service in `docker-compose.yml` for the vision pipeline, since `scripts/*.py` are Python. The plan must also read the existing **`extract-bom`, `bom`, `document-processor` and `process-document`** functions and state whether the MTO reuses their output schema and storage (preferred) or why it can't. Do not build a parallel BOM pipeline.

## 1. Goal

Take a P&ID sheet (PDF or image) and produce a **valve and instrument material take-off (MTO)** that Gatekeeper's procurement agents can price, benchmark and compare against vendor bids. Use deterministic checks to flag every item the system is unsure about, so an engineer reviews only the flagged rows.

The pitch to contractors: *"Upload the modification P&IDs and get a priced, checked valve and instrument MTO in minutes, with every uncertain item flagged for review."*

## 2. Scope

**In scope**
- Valves (all DEXPI valve classes incl. operated/control valves, safety valves, check valves)
- Instrument functions (e.g. `TICSA 4750.03`, `ESV 3712`)
- Line list (line number, DN, piping class, fluid code)
- Piping specialty items: reducers, orifices, blind flanges (counted, not priced)

**Out of scope (do not build)**
- Pipe lengths and metres. P&IDs are not to scale; lengths come from isometrics or the 3D model.
- Point clouds, 3D models, Blender, rendering
- Equipment sizing and datasheet extraction (an equipment tag list is enough)
- Multi-sheet off-page connector stitching (stretch goal only)
- Authentication or tenancy changes. Use whatever Gatekeeper already has.

## 3. Pipeline

```
PDF/PNG ─► S1 ingest ─► S2 text layer / OCR ─► S3 tiled vision extraction ─► S4 merge
       ─► S5 verifier (hard rules) ─► S6 MTO aggregation ─► S7 Gatekeeper handoff
```

| Stage | What it does | Notes |
|---|---|---|
| **S1 Ingest** | PDF → one PNG per page at 300 dpi (PyMuPDF). Images pass through. | Store the original file and a SHA-256 hash. |
| **S2 Text** | If the PDF has a text layer, extract every string with its bounding box (exact and cheap). Otherwise run OCR (Tesseract or the model's OCR) and keep the boxes. | The output is the **evidence set**: every tag and number the model claims must exist in it. |
| **S3 Extraction** | Split the page into overlapping tiles (~1024 px, 20% overlap) plus one downscaled full-page pass for context. A vision LLM returns JSON that conforms to the schema in §4, with a bounding box and confidence for each item. | Symbols are too small to detect reliably at full-page scale, which is why the page is tiled. Use a **fixed class vocabulary** (§4) and reject any class not in it. The prompt must cover **both symbol conventions**: ISO 10628 (bowtie valves, as on C01 and C02) and NORSOK/Equinor (a circle between two bars: filled = actuated shutdown valve, open = ball valve, as on C03). Report `actuated` separately from body type. |
| **S4 Merge** | De-duplicate items across tiles using box IoU and identical tag text. Assign each valve or instrument to a line by **tracing along the pipe** to the next line label, never by straight-line distance to the nearest label. | Keep a provenance record (tile ID, box) for every item. Nearest-label assignment fails on C01: the DN25 drain and instrument-branch valves on 47126 sit physically closer to the vertical `MNc 47125 73HG12 25` label. |
| **S5 Verifier** | Deterministic rules, no LLM (see below). Each rule either passes or raises a flag with a reason. | This verifier is the product's moat. Keep it in its own module with unit tests. |
| **S6 MTO** | Group valves by (class, DN, piping class) → quantity. Group instruments by function type. Output CSV/XLSX and JSON. | Each MTO row lists the item IDs it came from, so a reviewer can click through to the drawing. |
| **S7 Handoff** | Write the MTO into new tables and expose it to the coordinator as procurement line items (per the approved integration plan). | Technical-fit and cost-benchmark specialists consume it unchanged if possible. |

**S5 verifier rules (minimum set):**
1. **Grounding:** every tag, line number and DN in the output exists in the S2 evidence set, **either as a standalone token or as a parsed field of a grounded compound label**. On C03, `13L37007A`, `200` and `FS720` only exist inside `D-13L37007A-0200PB-FS720-0F000N`, and DNs are compared after removing zero-padding (`0200` = `200`). Fuzzy match ≥ 0.9 is allowed only for OCR, never for a text layer. Otherwise flag `UNGROUNDED`.
2. **Line label parses** with `scripts/line_parse.py`. Formats included: `dexpi_ref` (C01), `basf` (C02) and `equinor` (C03). Formats are pluggable per customer. Otherwise flag `LINE_FORMAT`.
3. **Valve DN ≤ DN of its line.** Otherwise flag `DN_EXCEEDS_LINE`.
4. **DN is in the allowed set** (15, 20, 25, 40, 50, 80, 100, 150, 200, 250, 300, … 1200). Otherwise flag `DN_INVALID`.
5. **Piping class of a valve equals its line's class**, or a spec break is drawn. Otherwise flag `CLASS_MISMATCH`.
6. **Every valve is attached to a line.** Otherwise flag `ORPHAN`.
7. **Instrument tag is well formed** (letters + number, e.g. `PICSA 4712.02`), and a valve **drawn with an actuator** (`actuated=true`) links to a controller, hand switch or ESD tag. Otherwise flag `INSTR_LOOP`. Note that DEXPI's `OperatedValve` class does *not* mean actuated: the C02 valves are DEXPI OperatedValves drawn as plain valves with no actuator, while the actuated control valves on C01 (PV4712.02, TV4750.03, HV4750.01) are `GlobeValve`.
8. **Duplicate tag on one sheet**, applied only to instrument loop tags and actuated-valve tags. Flag `DUPLICATE_TAG`. Never apply it to piping-component spec codes: `73KH12` appears 5 times on C01 and `H658B1UV` twice on C02, and both are correct. A field bubble and its DCS/panel bubble with the same tag (e.g. the two `ESV 3712` bubbles on C03) count as **one** instrument function, not a duplicate.

Flagged items go into the MTO with `status=needs_review`. Unflagged items are `status=auto`.

## 4. Data contracts

**Class vocabulary** (DEXPI ComponentClass names; the model must choose from these):
`BallValve, GlobeValve, GateValve, ButterflyValve, PlugValve, NeedleValve, SwingCheckValve, CheckValve, OperatedValve, SpringLoadedGlobeSafetyValve, SafetyValveOrFitting, BlindFlange, Flange, PipeReducer, RestrictionOrifice, FlowMeasuringElement, PipeTee, OTHER`
(**Dual-size valves:** a safety/relief valve labelled with inlet/outlet sizes (e.g. C01 `SV 104.01`, `DN = 25/50`) is reported with the **inlet** DN (`25`) and the **inlet** line's piping class (`73HG12`); put the full label in `raw_label`. `dn` on a valve is always a single number. `OTHER` is allowed but always flagged. `OperatedValve` is used only for an actuated valve whose body type is not shown, e.g. the NORSOK filled-circle ESV on C03. A generic valve symbol with no visible body type and no actuator is `OTHER`.)

**Extraction output per sheet** (same shape as `ground_truth/*.json`, so the scorer works unchanged):
```json
{
  "sheet_id": "uuid",
  "lines": [{"LineNumber": "47126", "NominalDiameterNumericalValueRepresentation": "50",
             "PipingClassCode": "75HB13", "FluidCode": "MNc", "raw_label": "MNc 47126 75HB13 50", "bbox": [x0,y0,x1,y1]}],
  "valves": [{"id": "v1", "class": "BallValve", "dn": "25", "piping_class": "75HB13", "line": "47126",
              "tag": "73KH12", "raw_label": "73KH12-25", "actuated": false, "bbox": [..], "confidence": 0.93,
              "flags": [], "status": "auto"}],
  "instruments": [{"category": "T", "functions": "ICSA", "number": "4750.03", "bbox": [..], "flags": []}],
  "piping_items": [{"class": "PipeReducer", "dn": "80/50", "line": "47124", "bbox": [..]}],
  "cost": {"input_tokens": 0, "output_tokens": 0, "usd": 0.0, "seconds": 0.0}
}
```

**New tables** (names may be adapted to Gatekeeper's conventions in the plan):
- `pid_job` (id, file_name, sha256, status, created_at, model, cost_usd, seconds)
- `pid_sheet` (id, job_id, page_no, image_path)
- `pid_item` (id, sheet_id, kind[line|valve|instrument|piping_item], payload JSONB, bbox, confidence, flags TEXT[], status[auto|needs_review|accepted|corrected])
- `pid_mto_line` (id, job_id, class, dn, piping_class, quantity, item_ids UUID[], status)

## 5. API (endpoints; implement as Supabase edge functions or the Python worker, per the integration plan)

| Method | Path | Purpose |
|---|---|---|
| POST | `/pid/jobs` | Upload a PDF or image; returns `job_id`. Processing runs async. |
| GET | `/pid/jobs/{id}` | Status, progress, cost |
| GET | `/pid/jobs/{id}/items` | All extracted items with flags and boxes |
| GET | `/pid/jobs/{id}/mto?format=json\|csv\|xlsx` | Aggregated MTO |
| PATCH | `/pid/items/{item_id}` | Engineer corrects or accepts an item; MTO recomputes |
| POST | `/pid/jobs/{id}/to-procurement` | Push accepted MTO lines into Gatekeeper's procurement flow |

## 6. UI (React/TS, one page)

- An upload area and the job status.
- **Left:** the drawing with item boxes overlaid (green = auto, amber = needs review, red = ungrounded).
- **Right:** the MTO table. Clicking a row highlights its source boxes. Flagged rows show the reason and accept/edit buttons.
- A header strip showing items found, % auto-accepted, cost and time for the sheet.
- An "Export CSV" button and a "Send to procurement" button.

No other screens.

## 7. Evaluation

**Datasets**
- `eval/clean`: the 3 drawings in `pid_mto_starter_pack/drawings` with their answer keys.
- `eval/synthetic`: ≥ 200 variants built by the generator in §8.
- `eval/real_unlabelled`: 10–20 sheets from the ASU dataset (Zenodo 8028570). These are run for robustness and flag rates only; there are no accuracy claims on them until Ali labels them by hand.

**Answer-key rule:** the answer keys score only what is visible on the drawing. Fields the DEXPI XML knows but the drawing does not show are `null` (not scored), and each one is explained in that file's `scoring_notes`. `tests/test_pack.py` checks the answer keys against line labels transcribed by hand from the drawings, and checks that a perfect extractor scores 1.0 with 0 unflagged errors. It must stay green.

**Run:** `make eval` runs the pipeline on every set, writes predictions to `eval/out/<set>/`, then runs `python3 scripts/score.py <gt_dir> <pred_dir>` and writes `eval/report.md` (metrics, cost per sheet, time per sheet, flag rate, the 10 worst sheets).

**Acceptance criteria (go/no-go for the customer conversations):**

| Metric (from `score.py`) | Clean set | Synthetic degraded set |
|---|---|---|
| `mto_valve_f1` | ≥ 0.95 | ≥ 0.90 |
| `line_f1` | 1.00 | ≥ 0.90 |
| `instrument_f1` | ≥ 0.95 | ≥ 0.85 |
| `unflagged_error_rate` (wrong or invented valves with `status=auto`) | 0 | ≤ 1% |
| Cost per sheet | ≤ $1.00 | ≤ $1.00 |
| Time per sheet | ≤ 3 min | ≤ 3 min |

The most important number is **unflagged errors** (`unflagged_errors_sum` and `unflagged_error_rate` in `score.py`; a prediction without a `status` field counts as auto). Flagged errors cost the customer a few seconds of review, but an unflagged wrong DN means a wrong purchase order. Track it explicitly: an item that is wrong against ground truth and has `status=auto`.

## 8. Synthetic data generator (`scripts/synth.py`)

Create variants of the drawings in `drawings/` (from `source_xml/` and the SVGs in the DEXPI repo, `gitlab.com/dexpi/TrainingTestCases`, `dexpi 1.3/example pids/C0x…/*.svg`):

1. Build a mapping table from old strings to new ones, **one whole label at a time**: a full line label, a full valve label like `73KH12-25`, or a full instrument number. Never substring-replace short numbers: replacing `50` would corrupt `T4750`, `4750.03`, `N5 50` and `2750`. Line numbers are generated in both formats (`dexpi_ref` and `equinor`), DNs are swapped within the allowed set while respecting rule 3 (valve ≤ line), and piping classes, instrument numbers and valve tags are swapped as well.
2. Apply the **same mapping** to whole SVG `<text>` nodes and to the XML label `Text String` values plus the matching `GenericAttribute` values, selected by exact attribute name (e.g. `NominalDiameterNumericalValueRepresentationAssignmentClass` on that component). Assert that every mapped string was found in both files; otherwise drop the variant.
3. Re-render the SVG to PNG (`rsvg-convert`). Also render **a vector PDF for every fifth variant** (`rsvg-convert -f pdf`) so the S2 text-layer path is actually exercised in `make eval`. Regenerate the answer key with `scripts/build_gt.py` from the mutated XML, then run `tests/test_pack.py`-style rule checks (rules 3 and 5) on every new key.
4. Degrade the images to look like scans: rotation ±2°, Gaussian blur, salt-and-pepper noise, JPEG quality 40–70, downsampling to 150–200 dpi, random stamps and revision clouds. Use `augraphy` or OpenCV with a fixed seed.
5. Write the variants to `eval/synthetic/{drawings,ground_truth}/` with matching file names.

Do not invent new topology (adding or removing valves) in v1. Changing text and image quality is enough to test extraction. Changing topology is v2.

## 9. Milestones (5 build days)

| Day | Deliverable | Done when |
|---|---|---|
| 0 | Integration plan (§0.1) | Ali approves it |
| 1 | S1–S2, data contracts, tables, `make eval` wired to `score.py` | Eval runs end to end on the clean set with a dummy predictor |
| 2 | S3–S4 extraction and merge | First real scores on the clean set |
| 3 | S5 verifier with unit tests, plus the synthetic generator (≥ 200 variants) | Scores on both sets; unflagged-error count reported |
| 4 | S6 MTO, S7 procurement handoff, API | A sheet goes from upload to procurement line items |
| 5 | UI, `eval/report.md`, a 3-minute demo script on C01 and C03 (Equinor) | Ali can run the demo without help |

## 10. Definition of done

- `make eval` passes the acceptance table, or the report states plainly which rows fail and why.
- The S5 rules each have unit tests (including the C01/C02/C03 edge cases in rules 1, 7 and 8), `scripts/line_parse.py` passes its own tests, and `tests/test_pack.py` passes.
- No customer, employer or scraped drawing is committed. DEXPI attribution (CC BY 4.0) is in the README and the UI footer.
- Every LLM call logs model, tokens, cost and latency.
- `docs/pid-mto-integration-plan.md` is updated to match what was actually built.
