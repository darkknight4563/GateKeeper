import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import * as XLSX from "https://esm.sh/xlsx@0.18.5";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

// PDF parser - simple text extraction from PDF bytes
async function parsePdf(bytes: Uint8Array, filename: string): Promise<Fragment[]> {
  const fragments: Fragment[] = [];
  
  try {
    // Convert bytes to string and extract readable text
    const decoder = new TextDecoder('utf-8', { fatal: false });
    let text = decoder.decode(bytes);
    
    // Remove PDF binary markers and extract text content
    // This is a simple approach - looks for text between common PDF delimiters
    text = text
      .replace(/\/[A-Za-z]+\s+/g, ' ') // Remove PDF commands
      .replace(/\[|\]|\(|\)/g, ' ')     // Remove brackets
      .replace(/<<|>>/g, ' ')           // Remove angle brackets
      .replace(/\s+/g, ' ')             // Normalize whitespace
      .trim();
    
    // Filter out non-printable characters
    text = text.replace(/[^\x20-\x7E\n\r\t]/g, '');
    
    if (text.length > 100) { // Require at least some content
      fragments.push({
        type: 'text',
        content: text,
        source: `${filename}`,
        metadata: {}
      });
    }
  } catch (error) {
    console.error('PDF parsing error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse PDF: ${message}`);
  }
  
  return fragments;
}

// XLSX parser - extracts tables from Excel
async function parseXlsx(bytes: Uint8Array, filename: string): Promise<Fragment[]> {
  const fragments: Fragment[] = [];
  
  try {
    const wb = XLSX.read(bytes, { type: 'buffer' });
    
    for (const sheetName of wb.SheetNames) {
      const sheet = wb.Sheets[sheetName];
      const range = XLSX.utils.decode_range(sheet['!ref'] || 'A1:Z200');
      
      const rows: any[][] = [];
      for (let R = range.s.r; R <= range.e.r; R++) {
        const row: any[] = [];
        for (let C = range.s.c; C <= range.e.c; C++) {
          const addr = XLSX.utils.encode_cell({ r: R, c: C });
          const cell = sheet[addr];
          row.push(cell?.v ?? '');
        }
        rows.push(row);
      }
      
      // Keep only non-empty grids
      const nonEmpty = rows.some(r => r.some(v => v !== ''));
      if (nonEmpty) {
        // Convert to markdown table format
        const tableText = rows.map(row => 
          row.map(cell => String(cell || '')).join(' | ')
        ).join('\n');
        
        fragments.push({
          type: 'table',
          content: tableText,
          source: `${filename}#${sheetName}!${sheet['!ref']}`,
          metadata: {
            sheet: sheetName,
            rows: rows.length,
            cols: range.e.c - range.s.c + 1
          }
        });
      }
    }
  } catch (error) {
    console.error('XLSX parsing error:', error);
    const message = error instanceof Error ? error.message : 'Unknown error';
    throw new Error(`Failed to parse XLSX: ${message}`);
  }
  
  return fragments;
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
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
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
      
      console.log(`Decoded ${fileBytes.length} bytes from base64`);

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
    let fragments: Fragment[];
    
    if (mime === 'application/pdf') {
      fragments = await parsePdf(fileBytes, filename);
    } else if (mime === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet') {
      fragments = await parseXlsx(fileBytes, filename);
    } else if (mime === 'application/vnd.ms-excel') {
      fragments = await parseXlsx(fileBytes, filename);
    } else if (mime === 'text/csv') {
      fragments = await parseCsv(fileBytes, filename);
    } else {
      return new Response(
        JSON.stringify({ error: `Unsupported MIME type: ${mime}` }),
        { status: 415, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    if (!fragments || fragments.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No text/tables extracted from document' }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`Extracted ${fragments.length} fragments from ${filename}`);

    // Call document-processor with structured fragments
    const processorResponse = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/document-processor`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
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
