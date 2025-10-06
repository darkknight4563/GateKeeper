// src/services/ingest.ts
type UploadItem =
  | File
  | { name: string; mime?: string; size?: number; file?: File } // sometimes UI stores file here
  | { name: string; mime?: string; storageUrl?: string };       // if you already uploaded to storage

export async function processFiles(items: UploadItem[]) {
  const out: any[] = [];
  for (const it of items) {
    try { out.push(await processOne(it)); }
    catch (e) { console.error(`Failed ${getName(it)}:`, e); }
  }
  return out;
}

async function processOne(item: UploadItem) {
  const { name, mime, bytes } = await getBytes(item);
  const b64 = toBase64(bytes);

  const payload = {
    filename: name,
    mime: mime || guessMime(name),
    size: bytes.length,
    file_b64: b64,
    ocr_lang: "eng+nor",
  };

  const FN_URL = "https://***REMOVED***.supabase.co/functions/v1/process-document";
  const ANON   = "***REMOVED***";

  const res = await fetch(FN_URL, {
    method: "POST",
    mode: "cors",
    credentials: "omit",
    headers: {
      "Content-Type": "application/json",
      "apikey": ANON,
      "Authorization": `Bearer ${ANON}`,
    },
    body: JSON.stringify(payload),
  });

  const data = await res.json();
  if (!res.ok) throw new Error(`${res.status} ${JSON.stringify(data)}`);
  return data;
}

function getName(it: UploadItem) {
  return it instanceof File ? it.name : (it as any).name ?? "unknown";
}

async function getBytes(it: UploadItem): Promise<{ name: string; mime?: string; bytes: Uint8Array }> {
  // Case 1: real File from input
  if (it instanceof File) {
    return { name: it.name, mime: it.type, bytes: new Uint8Array(await it.arrayBuffer()) };
  }
  // Case 2: the UI stored the File on a 'file' field
  const anyIt = it as any;
  if (anyIt?.file instanceof File) {
    const f: File = anyIt.file;
    return { name: getName(it), mime: f.type || anyIt.mime, bytes: new Uint8Array(await f.arrayBuffer()) };
  }
  // Case 3: already uploaded to storage → fetch the signed URL and read bytes
  if (anyIt?.storageUrl) {
    const res = await fetch(anyIt.storageUrl);
    if (!res.ok) throw new Error(`fetch storageUrl failed: ${res.status}`);
    const buf = await res.arrayBuffer();
    return { name: getName(it), mime: anyIt.mime, bytes: new Uint8Array(buf) };
  }
  // Not acceptable for MVP
  throw new Error("Item is not a File and has no storageUrl/file. Pass real File objects to process.");
}

function toBase64(bytes: Uint8Array) {
  // chunked to avoid call stack issues
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function guessMime(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf"))  return "application/pdf";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".csv"))  return "text/csv";
  return "application/octet-stream";
}
