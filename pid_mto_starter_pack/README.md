# P&ID → MTO starter data pack (public, licensed data only)

No employer or client drawings are included. Everything here comes from public datasets with an open license.

## What's in here

| Folder | Contents |
|---|---|
| `drawings/` | 3 rendered P&IDs (PNG, 2400 px wide), used as **input** to the extraction pipeline |
| `ground_truth/` | One JSON answer key per drawing, derived automatically from the DEXPI XML. Used for **scoring** |
| `source_xml/` | The DEXPI (Proteus XML) source behind each drawing. Machine-readable truth |
| `seed_xml_no_drawing/` | 32 small DEXPI unit-test cases (single tanks, pumps, instrument loops), with XML only and no drawing. Seeds for synthetic generation |
| `SPEC.md` | **Build spec for the coding agent. Start here.** |
| `scripts/build_gt.py` | Regenerates the answer keys: `python3 build_gt.py <dexpi example dir> <out dir>` |
| `scripts/score.py` | Deterministic scorer (prediction vs answer key). `python3 score.py ground_truth/ predictions/` |
| `scripts/line_parse.py` | Line-label parser (DEXPI reference, BASF, Equinor formats), with self-tests: `python3 line_parse.py` |
| `tests/test_pack.py` | Regression tests: answer keys vs hand-transcribed drawing labels, rule consistency, scorer behaviour. `python3 -I tests/test_pack.py` |

### The three eval drawings

| Drawing | Why it matters | Lines | Valves | Instrument functions |
|---|---|---|---|---|
| `C01_DEXPI_Reference_PID` | Full sheet: tank, 2 pumps, 2 heat exchangers, control loops, safety valve, equipment data tables | 12 | 11 | 4 |
| `C02_Process_Column_BASF` | BASF column; BASF line format; 3 generic valves (no body type, no line label: expect them flagged) | 1 | 3 | 3 |
| `C03_Piping_Equinor` | **Equinor / NORSOK-style line numbers** (e.g. `D-13L37007A-0200PB-FS720-0F000N`), ESV with ESD signal | 3 | 2 | 1 |

### Answer-key schema (per drawing)
```json
{
  "lines":   [{"LineNumber","NominalDiameterNumericalValueRepresentation","PipingClassCode","FluidCode","InsulationType","HeatTracingTypeRepresentation"}],
  "valves":  [{"class":"BallValve","line":"47126","dn":"25","piping_class":"75HB13","tag":"73KH12"}],
  "piping_items": [ ...flanges, reducers, orifices, fittings... ],
  "instruments":  [{"category":"T","functions":"ICSA","number":"4750.03"}],
  "equipment":    [{"class","tag"}]
}
```
An MTO line is a valve grouped by class, DN and piping class, with a count. Score the pipeline's output against this file.

**Answer keys score only what is visible on the drawing.** Fields the XML knows but the drawing doesn't show are `null` (not scored), with the reason in each file's `scoring_notes`. Line records come from the line labels actually printed on the sheet.

## Honest limits
- **Three drawings is a smoke test, not a benchmark.** It proves the pipeline runs end to end and catches regressions. It cannot support an "≥90% accuracy" claim to a customer.
- All three are clean vector renders. Legacy North Sea drawings are scanned, skewed, stamped and revision-clouded.
- Answer keys were audited against the drawings. Fixed so far: valve DN, empty instrument stubs, placeholder lines, multi-segment lines (C01 47124/47125), Unicode superscripts, C02 generic valves, and NORSOK piping class inheritance. `tests/test_pack.py` guards against regressions.

## Getting volume (recommended order)
1. **Synthetic variants from these seeds** (the best option, because the ground truth stays exact). Mutate the XML attributes (line numbers in NORSOK format, DN, piping class, instrument numbers) and the matching text in the SVG together, then re-render. Add scan degradation: rotation of ±2°, blur, noise, JPEG artefacts, downsampling to 150–200 dpi, fake stamps. Target 200–500 variants.
2. **PID2Graph**: Zenodo record 14803338, CC BY-SA 4.0, ~9.3 GB. Includes real OPEN100 nuclear-plant P&IDs with symbol and connection graph annotations. Good for symbol and topology checks, but it has **no text/tag ground truth** for MTO.
3. **ASU PID_dataset**: Zenodo record 8028570, CC BY 4.0, ~6.7 GB. Real P&IDs from industry and web scraping. Useful for robustness testing on messy real drawings; label 10–20 yourself. Web-scraped drawings may carry third-party rights, so use them only for internal testing and never in demos.
4. **Digitize-PID / Dataset-P&ID**: 500 synthetic sheets with symbol annotations (arXiv 2109.03794; mirrors on Hugging Face). Generic, and not NORSOK-styled.

## Licenses and attribution
- DEXPI example P&IDs: DEXPI Initiative, `gitlab.com/dexpi/TrainingTestCases`, **CC BY 4.0** (see `LICENSE_DEXPI_CC-BY-4.0.txt`). Commercial use is allowed with attribution.
- PID2Graph: Stürmer, Graumann & Koch (2025), IEEE DSAA. CC BY-SA 4.0 (ShareAlike: derivatives of the dataset must keep the same license).
- ASU PID_dataset: Gupta et al., Zenodo 8028570, CC BY 4.0.
