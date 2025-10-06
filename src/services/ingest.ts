import { supabase } from "@/integrations/supabase/client";

export async function processFile(file: File) {
  // turn the real bytes into base64
  const buf = await file.arrayBuffer();
  const b64 = btoa(String.fromCharCode(...new Uint8Array(buf)));

  const payload = {
    filename: file.name,
    mime: file.type || guessMime(file.name),
    size: file.size,
    file_b64: b64,
    ocr_lang: "eng+nor",
  };

  const { data, error } = await supabase.functions.invoke("process-document", {
    body: payload,
  });

  if (error) throw new Error(error.message);
  // { fragments: [...] }
  return data;
}

export async function processFiles(files: File[]) {
  const out: any[] = [];
  for (const f of files) {
    try { 
      out.push(await processFile(f)); 
    } catch (e) { 
      console.error(`Failed ${f.name}:`, e); 
    }
  }
  return out;
}

function guessMime(name: string) {
  const n = name.toLowerCase();
  if (n.endsWith(".pdf"))  return "application/pdf";
  if (n.endsWith(".xlsx")) return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
  if (n.endsWith(".docx")) return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  if (n.endsWith(".csv"))  return "text/csv";
  return "application/octet-stream";
}
