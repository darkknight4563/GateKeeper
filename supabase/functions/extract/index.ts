import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { file_ids, currencies } = await req.json();

    if (!file_ids || !Array.isArray(file_ids) || file_ids.length === 0) {
      return new Response(
        JSON.stringify({ error: 'file_ids array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const supportedCurrencies = currencies || ["USD", "EUR", "NOK"];

    console.log(`[EXTRACT] Processing ${file_ids.length} files for user ${user.id}`);

    // Fetch documents
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('*')
      .in('id', file_ids)
      .eq('user_id', user.id);

    if (docsError || !documents || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'No valid documents found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[EXTRACT] Found ${documents.length} documents to process`);

    // Process each document
    const extractedDocuments = [];

    for (const doc of documents) {
      console.log(`[EXTRACT] Processing document: ${doc.filename} (${doc.mime_type})`);

      // Determine file type
      const fileType = doc.mime_type.includes('pdf') ? 'pdf' 
        : doc.mime_type.includes('sheet') || doc.mime_type.includes('excel') ? 'xlsx'
        : doc.mime_type.includes('word') || doc.mime_type.includes('document') ? 'docx'
        : 'unknown';

      // Build extraction prompt based on file type
      const systemPrompt = `You are ClarityChain's Extraction Engine. You MUST extract structured procurement data from documents.

CRITICAL RULES:
1. NEVER infer or guess supplier names - if unlabeled, set null
2. EVERY numeric value MUST include a source pointer:
   - PDF: "pdf#p3" (page 3)
   - XLSX: "xlsx#Sheet1!B5" (Sheet1, cell B5)
   - DOCX: "docx#p2" (page 2)
3. Preserve EXACT numeric strings as found in document
4. If a field is not found, use null (not empty string)
5. Extract ONLY from actual document content - no demo data

File Type: ${fileType}
Document Name: ${doc.filename}
Supported Currencies: ${supportedCurrencies.join(', ')}`;

      const userPrompt = `Extract procurement data from this ${fileType.toUpperCase()} document.

Document metadata:
- Filename: ${doc.filename}
- Size: ${doc.file_size} bytes
- Upload status: ${doc.upload_status}

REQUIRED OUTPUT STRUCTURE:
{
  "doc_id": "${doc.id}",
  "supplier": "<exact name from document or null>",
  "currency": "<ISO code from document or null>",
  "line_items": [
    {
      "name": "<exact item name>",
      "qty": <numeric or null>,
      "unit": "<unit string or empty>",
      "unit_price": <numeric or null>,
      "subtotal": <numeric or null>,
      "source": "<${fileType}#location>"
    }
  ],
  "terms": {
    "delivery_weeks": <numeric or null>,
    "warranty_months": <numeric or null>,
    "payment_terms": "<exact terms or empty>",
    "validity_days": <numeric or null>,
    "source": "<${fileType}#location>"
  },
  "totals": {
    "quoted_price": <numeric or null>,
    "calculated_total": <numeric or null>,
    "source": "<${fileType}#location>"
  }
}

If this is a demo/mock file or contains no real procurement data, return diagnostic with missing fields marked as null.`;

      // Call Lovable AI with tool calling for structured extraction
      const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${lovableApiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          model: 'google/gemini-2.5-flash',
          messages: [
            { role: 'system', content: systemPrompt },
            { role: 'user', content: userPrompt }
          ],
          tools: [{
            type: 'function',
            function: {
              name: 'extract_document_data',
              description: 'Extract structured procurement data from document',
              parameters: {
                type: 'object',
                properties: {
                  doc_id: { type: 'string' },
                  supplier: { 
                    type: ['string', 'null'],
                    description: 'Exact supplier name from document or null if not found'
                  },
                  currency: { 
                    type: ['string', 'null'],
                    description: 'ISO currency code or null'
                  },
                  line_items: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        name: { type: 'string' },
                        qty: { type: ['number', 'null'] },
                        unit: { type: 'string' },
                        unit_price: { type: ['number', 'null'] },
                        subtotal: { type: ['number', 'null'] },
                        source: { 
                          type: 'string',
                          description: 'Source pointer like pdf#p3 or xlsx#Sheet1!B5'
                        }
                      },
                      required: ['name', 'source']
                    }
                  },
                  terms: {
                    type: 'object',
                    properties: {
                      delivery_weeks: { type: ['number', 'null'] },
                      warranty_months: { type: ['number', 'null'] },
                      payment_terms: { type: 'string' },
                      validity_days: { type: ['number', 'null'] },
                      source: { type: 'string' }
                    },
                    required: ['source']
                  },
                  totals: {
                    type: 'object',
                    properties: {
                      quoted_price: { type: ['number', 'null'] },
                      calculated_total: { type: ['number', 'null'] },
                      source: { type: 'string' }
                    },
                    required: ['source']
                  }
                },
                required: ['doc_id', 'supplier', 'currency', 'line_items', 'terms', 'totals'],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: 'function', function: { name: 'extract_document_data' } }
        })
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error(`[EXTRACT] AI error for ${doc.filename}:`, aiResponse.status, errorText);
        
        if (aiResponse.status === 429) {
          return new Response(
            JSON.stringify({ error: 'Rate limit exceeded, please try again later.' }),
            { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }
        
        if (aiResponse.status === 402) {
          return new Response(
            JSON.stringify({ error: 'Payment required, please add funds to your Lovable AI workspace.' }),
            { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
          );
        }

        // Return partial results with error marker
        extractedDocuments.push({
          doc_id: doc.id,
          supplier: null,
          currency: null,
          line_items: [],
          terms: { delivery_weeks: null, warranty_months: null, payment_terms: "", validity_days: null, source: "[Data Gap] Extraction failed" },
          totals: { quoted_price: null, calculated_total: null, source: "[Data Gap] Extraction failed" },
          error: `AI extraction failed: ${aiResponse.status}`
        });
        continue;
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

      if (!toolCall) {
        console.error(`[EXTRACT] No tool call for ${doc.filename}`);
        extractedDocuments.push({
          doc_id: doc.id,
          supplier: null,
          currency: null,
          line_items: [],
          terms: { delivery_weeks: null, warranty_months: null, payment_terms: "", validity_days: null, source: "[Data Gap] No extraction response" },
          totals: { quoted_price: null, calculated_total: null, source: "[Data Gap] No extraction response" }
        });
        continue;
      }

      const extractedData = JSON.parse(toolCall.function.arguments);
      extractedDocuments.push(extractedData);
      
      console.log(`[EXTRACT] Successfully extracted data from ${doc.filename}: ${extractedData.line_items?.length || 0} line items`);
    }

    const response = {
      documents: extractedDocuments,
      metadata: {
        processed_count: extractedDocuments.length,
        requested_count: file_ids.length,
        currencies_expected: supportedCurrencies,
        timestamp: new Date().toISOString()
      }
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[EXTRACT] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Extraction failed',
        documents: []
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
