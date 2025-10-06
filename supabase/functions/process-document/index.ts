// deno.json should allow npm imports. If not, add:
// { "tasks": {}, "nodeModulesDir": "auto" }

import { serve } from "https://deno.land/std@0.224.0/http/server.ts";
import * as pdfjs from "https://esm.sh/pdfjs-dist@4.3.136/legacy/build/pdf.mjs"; // legacy build, no worker
import * as XLSX from "https://esm.sh/xlsx@0.18.5";                    // Excel
// For DOCX we'll try mammoth via dynamic import at runtime to avoid build-time npm resolution issues.

// ----------- CORS -----------
const cors = {
  "Access-Control-Allow-Origin":
    Deno.env.get("ALLOWED_ORIGIN") ??
    "https://preview--docs-compare-flow.lovable.app",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(status: number, body: unknown) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });
}

// ----------- Helpers -----------
function b64ToBytes(b64: string) {
  const bin = atob(b64);
  const len = bin.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

type Fragment =
  | { source: string; text: string }
  | { source: string; table: unknown[][] };

type Payload = {
  filename: string;
  mime: string;
  size?: number;
  file_b64: string; // base64 of the file bytes
  ocr_lang?: string; // e.g. "eng+nor"
};

// ----------- OCR (managed) -----------
/**
 * Keep OCR out of your Edge runtime for now. Use a managed endpoint.
 * Wire any OCR provider here (OCR.space, Form Recognizer, Google DocAI, your own microservice).
 * Return plain text.
 */
async function runOCR(imageOrPdfBytes: Uint8Array, lang = "eng+nor"): Promise<string> {
  const OCR_API_URL = Deno.env.get("OCR_API_URL");   // <-- set this
  const OCR_API_KEY = Deno.env.get("OCR_API_KEY");   // <-- set this
  if (!OCR_API_URL || !OCR_API_KEY) {
    // Tell the caller exactly why we didn't OCR
    throw new Error("OCR not configured (set OCR_API_URL & OCR_API_KEY).");
  }
  const res = await fetch(OCR_API_URL, {
    method: "POST",
    headers: { "Authorization": `Bearer ${OCR_API_KEY}` },
    body: imageOrPdfBytes.buffer as ArrayBuffer, // or multipart if your provider wants it
  });
  if (!res.ok) throw new Error(`OCR failed: ${res.status} ${await res.text()}`);
  const data = await res.json();
  // Normalize to a single text block
  return (data.text || data.ocrText || "").toString();
}

// ----------- PDF parser -----------
async function parsePdf(bytes: Uint8Array, name: string): Promise<Fragment[]> {
  // Edge-safe: disable worker
  const doc = await (pdfjs as any).getDocument({ data: bytes, useWorker: false } as any).promise;
  const frags: Fragment[] = [];
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    const text = content.items.map((i: any) => i.str).join(" ").replace(/\s+/g, " ").trim();
    if (text.length) frags.push({ source: `${name}#p${p}`, text });
  }
  // If no text, OCR the whole PDF blob
  if (frags.length === 0) {
    const ocr = await runOCR(bytes, "eng+nor");
    if (ocr && ocr.trim().length) {
      frags.push({ source: `${name}#ocr`, text: ocr.replace(/\s+/g, " ").trim() });
    }
  }
  return frags;
}

// ----------- DOCX parser -----------
async function parseDocx(bytes: Uint8Array, name: string): Promise<Fragment[]> {
  // Mammoth is not available in this Edge runtime; handle DOCX server-side
  // or convert to PDF/text before calling this function.
  throw new Error('DOCX parsing not available in this runtime. Handle server-side.');
}

// ----------- XLSX parser -----------
function parseXlsx(bytes: Uint8Array, name: string): Fragment[] {
  const wb = XLSX.read(bytes, { type: "array" });
  const out: Fragment[] = [];
  for (const sheetName of wb.SheetNames) {
    const ws = wb.Sheets[sheetName];
    if (!ws) continue;
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
      header: 1,
      raw: true,
      defval: "",
    });
    const hasData = rows.some(r => r.some(c => c !== ""));
    if (!hasData) continue;
    // Cap to keep Edge happy
    const limited = rows.slice(0, 800).map(r => r.slice(0, 30));
    const ref = ws["!ref"] || "A1";
    out.push({ source: `${name}#${sheetName}!${ref}`, table: limited });
  }
  if (!out.length) throw new Error("XLSX contained no readable cells.");
  return out;
}

// ----------- Router -----------
serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { status: 200, headers: cors });

  try {
    const payload = (await req.json()) as Payload;

    console.log("INGEST DEBUG", {
      filename: payload?.filename,
      mime: payload?.mime,
      len: payload?.file_b64 ? payload.file_b64.length : 0,
      head: payload?.file_b64?.slice?.(0, 40) ?? null,
    });

    // Sanitize base64 - strip data URL prefix if present
    function sanitizeB64(s: string) {
      if (!s) return s;
      const i = s.indexOf(","); 
      return s.startsWith("data:") && i >= 0 ? s.slice(i + 1) : s.replace(/\s/g, "");
    }

    const raw = payload.file_b64;
    payload.file_b64 = sanitizeB64(raw);

    if (!payload.file_b64 || payload.file_b64.length < 100) {
      return json(400, { error: "Empty file_content (base64) after sanitize" });
    }

    const bytes = b64ToBytes(payload.file_b64);
    const { filename, mime } = payload;
    if (!filename || !mime) return json(400, { error: "Missing filename or mime" });

    // quick magic number check for PDFs
    if (mime.includes("pdf") && bytes[0] !== 0x25 /* % */) {
      return json(400, { error: "Invalid PDF header (not %PDF)" });
    }

    let fragments: Fragment[] = [];
    if (mime.includes("pdf")) {
      fragments = await parsePdf(bytes, filename);
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      filename.toLowerCase().endsWith(".xlsx")
    ) {
      fragments = parseXlsx(bytes, filename);
    } else if (
      mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
      filename.toLowerCase().endsWith(".docx")
    ) {
      fragments = await parseDocx(bytes, filename);
    } else if (mime.startsWith("image/")) {
      const text = await runOCR(bytes, payload.ocr_lang ?? "eng+nor");
      if (text.trim().length) fragments.push({ source: `${filename}#ocr`, text: text.replace(/\s+/g, " ").trim() });
    } else if (mime.startsWith("text/")) {
      const text = new TextDecoder("utf-8").decode(bytes).replace(/\s+/g, " ").trim();
      if (text.length) fragments.push({ source: `${filename}#text`, text });
    } else {
      return json(415, { error: `Unsupported mime: ${mime}` });
    }

    if (!fragments.length) {
      return json(422, {
        error: "No text/tables extracted. If PDF is scanned, configure OCR.",
        diagnostics: { filename, mime, bytes: bytes.length },
      });
    }

    // Return fragments to your LLM extractor or call it right here.
    return json(200, { fragments });

  } catch (e: any) {
    return json(500, { error: `process-document error: ${e.message}` });
  }
});
