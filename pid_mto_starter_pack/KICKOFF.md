# Day 0 kickoff prompt (paste into the coding agent)

Check out branch `feature/pid-mto`. Run:

```
python3 -I pid_mto_starter_pack/tests/test_pack.py
python3 -I pid_mto_starter_pack/scripts/line_parse.py
```

Confirm both print ALL PASS. Then read `pid_mto_starter_pack/SPEC.md` in full, especially §0.1 and §0.6 (including "Facts verified in the repo").

Inspect this repository: Supabase migrations and RLS policies, Storage usage, the `extract-bom`, `bom`, `document-processor` and `process-document` edge functions, the React/Vite frontend, and any existing tests or eval scripts. Then write `docs/pid-mto-integration-plan.md` covering:

a) Existing document/BOM/procurement tables, RLS and tenancy columns, and the TypeScript types the plan touches.
b) How `extract-bom` and `bom` work today, and how approved MTO rows will be mapped into the `BOMItem` shape at the S6→S7 handoff without bypassing S1–S5 (tiling, grounding, deterministic verification).
c) The split between Supabase edge functions (control plane) and the Python S1–S6 worker/CLI (compute plane), and how `make eval` runs locally without production Supabase.
d) The proposed `PID_VISION_MODEL`, its price per 1M input/output tokens, estimated tiles per sheet, and projected cost (USD) and time per sheet against the ≤ $1.00 and ≤ 3 min gates.
e) The exact list of new files to add and existing files to modify, with zero breaking changes to existing tables or APIs.

Do not write any application code, migrations or endpoints until Ali approves `docs/pid-mto-integration-plan.md`.
