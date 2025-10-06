import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";
import * as pdfjsLib from "https://esm.sh/pdfjs-dist@4.3.136/legacy/build/pdf.mjs";

const corsHeaders = {
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

type Payload = { 
  filename: string; 
  mime: string; 
  size: number; 
  file_b64: string;
  document_id?: string;
};

interface Fragment {
  type: 'text' | 'table';
  content: string;
  source: string;
  metadata?: Record<string, any>;
}

// PDF parser - extracts text from PDF using pdfjs in no-worker mode
async function parsePdf(bytes: Uint8Array, filename: string): Promise<Fragment[]> {
  try {
    console.log(`=== PDF PARSING START: ${filename} ===`)
    console.log(`PDF bytes received: ${bytes.length}`)
    
    // Disable worker in Edge/Deno - use legacy build and no worker
    // Explicitly disable worker to avoid GlobalWorkerOptions requirement
    // Guarded workerSrc setup to avoid write on read-only module property
    try {
      const gw = (pdfjsLib as any).GlobalWorkerOptions
      if (gw && typeof gw === 'object') {
        gw.workerSrc = "https://esm.sh/pdfjs-dist@4.3.136/legacy/build/pdf.worker.mjs"
      }
    } catch (_) {
      // Ignore if GlobalWorkerOptions is read-only or unavailable
    }

    const pdf = await (pdfjsLib as any).getDocument({ 
      data: bytes, 
      useWorker: false,
      isEvalSupported: false,
      useSystemFonts: true
    }).promise;

    console.log(`PDF loaded successfully: ${pdf.numPages} pages`)

    const out: Array<{ source: string; text: string }> = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const content = await page.getTextContent();
      const text = content.items
        .map((i: any) => i.str)
        .join(" ")
        .replace(/\s+/g, " ")
        .trim();
      if (text.length > 0) {
        out.push({ source: `${filename}#p${p}`, text });
        console.log(`Page ${p}: extracted ${text.length} chars`)
      } else {
        console.log(`Page ${p}: no text found`)
      }
    }

    console.log(`PDF extraction complete: ${out.length} fragments from ${pdf.numPages} pages`)

    // OCR detection: if PDF loaded but no text extracted, it's image-only
    if (pdf.numPages > 0 && out.length === 0) {
      console.error(`PDF is image-only (scanned): ${pdf.numPages} pages, 0 text fragments`)
      throw new Error("PDF is image-only (scanned). Please enable OCR or upload a text-based PDF.");
    }
    
    // Convert to Fragment format
    return out.map(item => ({
      type: 'text' as const,
      content: item.text,
      source: item.source,
      metadata: { page: parseInt(item.source.split('#p')[1]) }
    }));
  } catch (error) {
    console.error('PDF parsing error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse PDF: ${message}`);
  }
}

// XLSX parser - extracts tables from Excel with size limits to avoid timeouts
async function parseXlsx(bytes: Uint8Array, filename: string): Promise<Fragment[]> {
  try {
    console.log(`=== XLSX PARSING START: ${filename} ===`)
    console.log(`XLSX bytes received: ${bytes.length}`)
    
    // In Supabase Edge, prefer type: "array"
    const wb = XLSX.read(bytes, { type: 'array' });

    console.log(`XLSX loaded: ${wb.SheetNames.length} sheets`)
    console.log(`Sheet names: ${JSON.stringify(wb.SheetNames)}`)

    const fragments: Fragment[] = [];
    for (const sheetName of wb.SheetNames) {
      console.log(`Processing sheet: ${sheetName}`)
      const ws = wb.Sheets[sheetName];
      if (!ws) {
        console.log(`Sheet ${sheetName}: no data object`)
        continue;
      }

      // Array-of-arrays for speed; keep numbers raw; provide defaults
      const rows: any[][] = XLSX.utils.sheet_to_json(ws, {
        header: 1,
        raw: true,
        defval: ''
      });

      // Skip empty sheets and cap size to avoid timeouts
      const hasData = rows.some(r => r.some(c => c !== ''));
      if (!hasData) {
        console.log(`Sheet ${sheetName}: empty (no data)`)
        continue;
      }

      const limited = rows.slice(0, 800); // cap rows
      const cols = Math.min(
        Math.max(...limited.map(r => r.length)),
        30 // cap columns
      );
      const limitedCols = limited.map(r => r.slice(0, cols));

      console.log(`Sheet ${sheetName}: ${limitedCols.length} rows x ${cols} columns (capped)`)

      const ref = ws['!ref'] || `A1:${XLSX.utils.encode_cell({ r: limitedCols.length, c: cols })}`;
      
      // Convert to markdown table format
      const tableText = limitedCols.map(row => 
        row.map(cell => String(cell || '')).join(' | ')
      ).join('\n');

      fragments.push({
        type: 'table',
        content: tableText,
        source: `${filename}#${sheetName}!${ref}`,
        metadata: {
          sheet: sheetName,
          rows: limitedCols.length,
          cols: cols
        }
      });
      
      console.log(`Sheet ${sheetName}: fragment created, ${tableText.length} chars`)
    }

    console.log(`XLSX extraction complete: ${fragments.length} fragments`)

    if (fragments.length === 0) {
      throw new Error('XLSX contained no readable cells (empty or unsupported).');
    }
    
    return fragments;
  } catch (error) {
    console.error('XLSX parsing error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse XLSX: ${message}`);
  }
}

// CSV parser - extracts table from CSV
async function parseCsv(bytes: Uint8Array, filename: string): Promise<Fragment[]> {
  const fragments: Fragment[] = [];
  
  try {
    const decoder = new TextDecoder('utf-8');
    const csvText = decoder.decode(bytes);
    
    // Parse CSV lines
    const lines = csvText.split('\n').filter(line => line.trim().length > 0);
    
    if (lines.length > 0) {
      fragments.push({
        type: 'table',
        content: lines.join('\n'),
        source: `${filename}#csv`,
        metadata: { rows: lines.length }
      });
    }
  } catch (error) {
    console.error('CSV parsing error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse CSV: ${message}`);
  }
  
  return fragments;
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const body = await req.json() as Payload;
    
    // Support both old API (document_id) and new API (file_b64)
    let filename: string;
    let mime: string;
    let size: number;
    let fileBytes: Uint8Array;
    let documentId: string;

    if (body.document_id) {
      // Old API: fetch from storage
      const { data: document, error: docError } = await supabase
        .from('documents')
        .select('*')
        .eq('id', body.document_id)
        .eq('user_id', user.id)
        .single();

      if (docError || !document) {
        return new Response(
          JSON.stringify({ error: 'Document not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      documentId = body.document_id;
      filename = document.filename;
      mime = document.mime_type;
      size = document.file_size;

      // Download from storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('procurement-documents')
        .download(document.file_path);

      if (downloadError || !fileData) {
        throw new Error('Failed to download file from storage');
      }

      const arrayBuffer = await fileData.arrayBuffer();
      fileBytes = new Uint8Array(arrayBuffer);
    } else {
      // New API: decode base64
      if (!body.file_b64 || body.file_b64.length < 100) {
        return new Response(
          JSON.stringify({ error: 'Empty file_content (base64)' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      filename = body.filename;
      mime = body.mime;
      size = body.size;
      
      // Decode base64 to bytes
      fileBytes = Uint8Array.from(atob(body.file_b64), c => c.charCodeAt(0));
      
      console.log(`=== BASE64 DECODE ===`)
      console.log(`Decoded ${fileBytes.length} bytes from base64`)
      console.log(`Expected size: ${size} bytes`)
      console.log(`MIME type: ${mime}`)

      // Validate decoded bytes
      if (!fileBytes.length) {
        return new Response(
          JSON.stringify({ error: 'Decoded file is empty' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // PDF-specific validation: check for %PDF header
      if (mime === 'application/pdf' && fileBytes[0] !== 0x25 /* '%' */) {
        return new Response(
          JSON.stringify({ error: 'Invalid PDF bytes (missing %PDF header).' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Validation
      if (!size || size === 0) {
        return new Response(
          JSON.stringify({ error: 'Empty file received' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (size > 50 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ error: 'File exceeds 50MB limit' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      // Create document record
      const { data: newDoc, error: insertError } = await supabase
        .from('documents')
        .insert({
          filename,
          file_size: size,
          mime_type: mime,
          upload_status: 'processing',
          user_id: user.id,
          file_path: `temp/${user.id}/${Date.now()}-${filename}`
        })
        .select()
        .single();

      if (insertError || !newDoc) {
        throw new Error('Failed to create document record');
      }

      documentId = newDoc.id;
    }

    // Parse file based on MIME type
    console.log(`=== PARSING FILE ===`)
    console.log(`Filename: ${filename}`)
    console.log(`MIME: ${mime}`)
    console.log(`Size: ${fileBytes.length} bytes`)
    
    let fragments: Fragment[];
    
    if (mime === 'application/pdf') {
      console.log('Using PDF parser')
      fragments = await parsePdf(fileBytes, filename);
    } else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      console.log('Using XLSX parser (OpenXML)')
      fragments = await parseXlsx(fileBytes, filename);
    } else if (mime === 'application/vnd.ms-excel') {
      console.log('Using XLSX parser (legacy Excel)')
      fragments = await parseXlsx(fileBytes, filename);
    } else if (mime === 'text/csv') {
      console.log('Using CSV parser')
      fragments = await parseCsv(fileBytes, filename);
    } else {
      console.error(`Unsupported MIME type: ${mime}`)
      return new Response(
        JSON.stringify({ error: `Unsupported MIME type: ${mime}` }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`=== PARSING COMPLETE ===`)
    console.log(`Extracted ${fragments.length} fragments from ${filename}`)
    console.log(`Fragment types: ${fragments.map(f => f.type).join(', ')}`)
    console.log(`Fragment sources: ${fragments.map(f => f.source).join(', ')}`)

    if (!fragments || fragments.length === 0) {
      console.error('ERROR: No fragments extracted')
      return new Response(
        JSON.stringify({ error: 'No text/tables extracted from document' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Extracted ${fragments.length} fragments from ${filename}`);

    // Call document-processor with structured fragments
    const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
    const processorResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/document-processor`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': anonKey!,
          'Authorization': authHeader
        },
        body: JSON.stringify({
          document_id: documentId,
          filename,
          mime_type: mime,
          fragments
        })
      }
    );

    const parsed = await processorResponse.json();
    
    if (!processorResponse.ok) {
      throw new Error(`document-processor: ${processorResponse.status} ${JSON.stringify(parsed)}`);
    }

    return new Response(
      JSON.stringify({ 
        job_id: documentId,
        status: 'completed',
        message: 'Document processed successfully',
        parsed 
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('process-document error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    return new Response(
      JSON.stringify({ error: `process-document error: ${message}` }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  }
});
