# P&ID → MTO integration plan for GateKeeper

**Branch:** `feature/pid-mto` · **Base:** `3ed7ba1` · **Status:** DRAFT. Waiting on **one decision (§2.3)** and Ali's approval. No code is written before approval (SPEC §0.1).

Every fact below was read from the repo at the base commit. Nothing is marked "verify later".

---

## 1. Existing data model, ownership and contracts (§0.1a)

### 1.1 Tables (from `supabase/migrations/`)
| Table | Key columns | Relevance |
|---|---|---|
| `documents` | `id, filename, file_path, file_size, mime_type, upload_status ('pending','processing','completed','error'), user_id → auth.users, created_at, updated_at` | Each P&ID upload is **one `documents` row**. |
| `processing_jobs` | `id, document_id → documents, job_status ('queued','processing','completed','failed'), job_type TEXT DEFAULT 'document_analysis' (no CHECK), progress 0–100, error_message, result_data JSONB, created_at, updated_at` | **Reused as the P&ID job** with `job_type = 'pid_mto'`. This replaces the proposed `pid_job` table. |
| `vendor_offers` | `document_id, vendor_name, quoted_price, currency, items_count, extracted_data JSONB` | The downstream procurement object. There is **no requirement or line-item table**. |
| `tco_calculations`, `risk_assessments`, `lead_time_analysis` | FK `vendor_offer_id` | Per-offer analyses. |
| `approval_workflows`, `approval_audit_logs` | FK `document_id` / `workflow_id` | Approval flow. |

### 1.2 RLS (exact pattern to copy)
- `documents`: `USING (auth.uid() = user_id)` for SELECT/UPDATE, and `WITH CHECK (auth.uid() = user_id)` for INSERT.
- Child tables: `USING (document_id IN (SELECT id FROM public.documents WHERE user_id = auth.uid()))`.
- Existing tables define **only SELECT, INSERT and UPDATE policies, no DELETE**. New tables follow the same pattern; deletes happen through `ON DELETE CASCADE` from `documents`.

### 1.3 Storage
- The bucket is `procurement-documents`. The object path must start with `<auth.uid()>/` (policy: `(storage.foldername(name))[1] = auth.uid()::text`).
- P&ID files go to `procurement-documents/<uid>/pid/<document_id>/original.<ext>`, and rendered sheets to `…/<document_id>/sheets/<page>.png`. **No new bucket or storage policy is needed.**

### 1.4 Types and frontend
- Supabase client: `src/integrations/supabase/client.ts`. Generated DB types: `src/integrations/supabase/types.ts`, which **must be regenerated** after the migration.
- `BOMItem` / `BOMExtractionResult` live in `src/services/advancedDocumentApi.ts`, with snake_case fields: `item, quantity, unit_price, total_price?, part_number?, description?, category?`.
- Router: `src/App.tsx` (react-router `<Routes>`). Pages: `src/pages/` (`Index`, `ApprovalWorkflow`, `Auth`, `NotFound`).
- There is no `.env.example`. The `.env` was removed in `3ed7ba1`, so a new `.env.example` is **added**.

### 1.5 Edge function conventions
- One folder per function under `supabase/functions/<kebab-name>/index.ts`, using Deno `serve`.
- Shared CORS headers. Auth comes from the `Authorization: Bearer` header via `supabase.auth.getUser(token)`, with a service-role client from `SUPABASE_URL` / `SUPABASE_SERVICE_ROLE_KEY`.
- The LLM is reached through `https://ai.gateway.lovable.dev/v1/chat/completions` with `LOVABLE_API_KEY`; the model everywhere is `google/gemini-2.5-flash`.
- `process-document` already calls an external OCR service through `OCR_API_URL` / `OCR_API_KEY`.

### 1.6 Compatibility guarantee
There are **no changes** to existing tables, policies, or the `extract-bom`, `bom` and `process-document` functions. The migration is additive. The `processing_jobs` reuse needs no schema change, because `job_type` is free text.

---

## 2. System boundary and reuse (§0.1b, §0.6)

### 2.1 Control plane vs compute plane
| Plane | Runtime | Responsibilities |
|---|---|---|
| Control | Supabase (Postgres, Storage, Deno edge functions) | Upload: create a `documents` row, the Storage object and a `processing_jobs` row (`job_type='pid_mto'`, `queued`). Status reads, item list, item PATCH plus MTO recompute, export. |
| Compute | Python worker `services/pid_mto/` (Docker service and local CLI) | S1–S6 plus `make eval`. It writes `pid_sheet`, `pid_item` and `pid_mto_line` rows and updates `processing_jobs` (`job_status`, `progress`, `result_data`, `error_message`). |

**Dispatch:** the worker **polls** `processing_jobs WHERE job_type='pid_mto' AND job_status='queued'` using the service role, and claims a job with `UPDATE … SET job_status='processing' … RETURNING`. This adds no new public endpoint and no shared secret, and it reuses the existing status columns the UI already understands. A webhook was rejected because it would add an exposed URL plus a secret for no benefit at prototype volume.

**`result_data` for a P&ID job:** `{sha256, model, input_tokens, output_tokens, cost_usd, seconds, sheets, items_total, auto_rate}`.

### 2.2 What `extract-bom` and `bom` actually are (corrects SPEC §0.6 and the earlier draft)
- **`extract-bom`** converts existing OCR output (`{ocr_data:{text, tables}}`) into `BOMItem[]` and returns JSON. It writes nothing, and no frontend code in `src/` invokes it.
- **`bom`** is a **fiber-optic cable spec comparator**: it sends supplier documents to Gemini and extracts tubes, fibers, outer diameter, weight, bend radius, length, standards and certifications. It is unrelated to valves and is **not** a downstream procurement flow.
- **Reuse decision:** reuse the **`BOMItem` / `BOMExtractionResult` types** as the MTO export shape. Do not call either function. Neither is ever sent P&ID images or P&ID text.
  - MTO row → `BOMItem`: `item` = "Ball valve DN25 75HB13", `quantity` = count, `unit_price` = 0 (unpriced), `part_number` = valve spec code when every grouped item shares one (e.g. `73KH12`), otherwise `"<class>-DN<dn>-<piping_class>"`, `category` = `"valve"` / `"instrument"` / `"piping_specialty"`, `description` = flags summary.

### 2.3 ⚠ Decision needed from Ali: where does "Send to procurement" go?
This repo has **no requirement or line-item table** and **no coordinator/specialist agents**. Those live in the FastAPI + Claude Gatekeeper backend, which is not this repo. Options:
- **A (recommended for the 2-week test):** "Send to procurement" writes a `BOMExtractionResult` into `processing_jobs.result_data.mto_bom` and enables CSV/XLSX export. The contractor demo ends at a checked, exportable MTO. No new procurement schema.
- **B:** push the MTO to the FastAPI coordinator backend over its API. That needs that repo plus an auth design, and adds roughly 1–2 days.
- **C:** add a `requirements` table that `vendor_offers` are compared against. That is a product change, out of scope for validation.

---

## 3. New schema (one additive migration)

`supabase/migrations/<timestamp>_pid_mto.sql`:

```sql
CREATE TABLE public.pid_sheet (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_job_id UUID NOT NULL REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
  page_no INTEGER NOT NULL,
  image_path TEXT NOT NULL,                -- storage path in procurement-documents
  width_px INTEGER, height_px INTEGER,
  text_source TEXT CHECK (text_source IN ('pdf_text_layer','ocr')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.pid_item (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  sheet_id UUID NOT NULL REFERENCES public.pid_sheet(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('line','valve','instrument','piping_item')),
  payload JSONB NOT NULL, bbox JSONB, confidence REAL,
  flags TEXT[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('auto','needs_review','accepted','corrected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(), updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE public.pid_mto_line (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  processing_job_id UUID NOT NULL REFERENCES public.processing_jobs(id) ON DELETE CASCADE,
  class TEXT, dn TEXT, piping_class TEXT,
  quantity INTEGER NOT NULL, item_ids UUID[] NOT NULL DEFAULT '{}',
  status TEXT NOT NULL CHECK (status IN ('auto','needs_review','accepted','corrected')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
-- indexes on every FK; RLS enabled on all three
```

**Policies** (SELECT/INSERT/UPDATE only, matching the repo):
- `pid_sheet` and `pid_mto_line`: `processing_job_id IN (SELECT pj.id FROM public.processing_jobs pj JOIN public.documents d ON d.id = pj.document_id WHERE d.user_id = auth.uid())`
- `pid_item`: `sheet_id IN (SELECT s.id FROM public.pid_sheet s JOIN public.processing_jobs pj ON pj.id = s.processing_job_id JOIN public.documents d ON d.id = pj.document_id WHERE d.user_id = auth.uid())`
- The worker uses the service role and bypasses RLS.

---

## 4. Edge functions (SPEC §5 mapped to repo convention)
| Function | Method and body | Does |
|---|---|---|
| `pid-jobs` | POST `{filename, file_path, file_size, mime_type}` after the client uploads to Storage. GET `?job_id=` | Creates `documents` + `processing_jobs(job_type='pid_mto')`. Returns status, progress and `result_data`. |
| `pid-items` | GET `?job_id=` · PATCH `{item_id, payload?, status}` | Lists items with signed sheet URLs. A PATCH edits an item and **recomputes `pid_mto_line` for that job inside the same function** (a SQL aggregation, no Python). |
| `pid-mto` | GET `?job_id=&format=json\|csv` | The aggregated MTO. XLSX is produced by the worker at job completion and stored next to the sheets. |
| `pid-to-procurement` | POST `{job_id}` | Per the §2.3 decision. Under option A it writes `result_data.mto_bom`. It **refuses** if any `needs_review` row remains unless `{include_unreviewed:false}` is passed explicitly. |

All four use the repo's CORS and `getUser` auth pattern.

---

## 5. Vision model, cost and latency (§0.1d)
- **Default `PID_VISION_MODEL`:** `google/gemini-2.5-flash` through the **same Lovable AI gateway and `LOVABLE_API_KEY`** the repo already uses. It is vision-capable and needs no new vendor account. Alternatives (Claude, GPT) sit behind the same adapter for comparison runs.
- **Tiles per sheet:** 2400×1700 px at 1024 px tiles with 20% overlap gives 3×2 = 6 tiles + 1 context pass = **7 calls**. A 300 dpi A1 scan (~7000×5000 px) gives **≈ 54 calls**. **Downscale scans to ≤ 3500 px on the long side** (≈ 4×3 = 12 tiles + 1 = **13 calls**), and verify on the synthetic set that this loses no small text such as `AS9`.
- **Tokens (estimate):** ~1–1.5k image tokens per 1024 px tile, plus ~2k prompt and schema tokens per call. That is ≈ 20–45k input and 5–15k output tokens per sheet.
- **Price:** **not filled in here on purpose.** The worker logs actual tokens and USD per call. On Day 2 the agent runs the 3 clean sheets and reports **measured** cost per sheet from the gateway's billing or price page (cited). Gate: ≤ $1.00 per sheet. At the token estimate above, any mid-tier vision model lands well under $1, so the risk is low but must be measured, not asserted.
- **Latency:** S1/S2 take 5–15 s, 7–13 calls at concurrency 4 take 15–40 s, and S4–S6 take under 1 s, for ≈ 25–60 s per sheet against the 3-minute gate. Gateway rate limits (the `bom` function already handles 429 and 402) need backoff in the worker.

---

## 6. Eval and CI
- Existing tests: Deno tests in `supabase/functions/_tests/` (`document-validation`, `tco-calculator`). CI (`.github/workflows/ci-cd.yml`) runs `npm ci`, `npm run lint`, `npx tsc --noEmit`, `npm run build`, then Deno.
- **Add a CI job** `pid-mto-python` that runs `python3 -I pid_mto_starter_pack/tests/test_pack.py`, `scripts/line_parse.py` and `pytest services/pid_mto/tests`. This is an additive edit to `ci-cd.yml`, with no change to existing jobs. **No model calls in CI.**
- `make eval` runs locally and offline against the eval sets (clean, synthetic ≥ 200 with every fifth as a vector PDF, ASU unlabelled), scores only through `score.py`, and writes `eval/report.md`.

---

## 7. Files

### Add
- `supabase/migrations/<timestamp>_pid_mto.sql`
- `supabase/functions/pid-jobs/index.ts`, `pid-items/index.ts`, `pid-mto/index.ts`, `pid-to-procurement/index.ts`
- `services/pid_mto/`:
  - `pyproject.toml`, `Dockerfile`
  - `app/schemas.py`, `s1_ingest.py`, `s2_text.py`, `s3_vision.py`, `s4_merge.py`, `s5_verifier.py`, `s6_mto.py`, `pipeline.py`, `worker.py`
  - `scripts/synth.py`, `run_eval.py`
  - `tests/test_s5_verifier.py`, `test_pipeline_smoke.py`
- `src/pages/PidMto.tsx`, `src/components/pid/DrawingOverlay.tsx`, `src/components/pid/MtoReviewTable.tsx`, `src/services/pidApi.ts`
- `.env.example` (`PID_VISION_MODEL`, `LOVABLE_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`, `OCR_API_URL`, `OCR_API_KEY`), `Makefile` (`eval`, `test-pid`)

### Modify (additive only)
- `src/App.tsx`: one `<Route path="/pid-mto">` plus a nav entry.
- `src/integrations/supabase/types.ts`: regenerated for the three new tables.
- `docker-compose.yml`: a `pid-worker` service.
- `.github/workflows/ci-cd.yml`: the `pid-mto-python` job.
- `README.md`: DEXPI CC BY 4.0 attribution and `make eval` instructions.

### Untouched
All existing migrations, `extract-bom`, `bom`, `process-document`, and all existing pages and components.

---

## 8. Approval gate
1. Ali picks **§2.3 option A, B or C**.
2. Ali approves this plan. Day 1 then starts with the migration, `processing_jobs` dispatch, and `make eval` wired to `score.py` with a dummy predictor.
