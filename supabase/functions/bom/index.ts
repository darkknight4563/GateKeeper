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

    const { documents } = await req.json();

    if (!documents || !Array.isArray(documents)) {
      return new Response(
        JSON.stringify({ error: 'documents array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[BOM] Extracting technical specs from ${documents.length} suppliers`);

    const bomData = [];

    for (const doc of documents) {
      const supplier = doc.supplier || "[Unknown Supplier]";
      console.log(`[BOM] Processing ${supplier}`);

      // Build extraction context from line items
      const lineItemsContext = doc.line_items?.map((item: any, idx: number) => 
        `Item ${idx + 1}: ${item.name || 'Unnamed'} | Qty: ${item.qty || 'N/A'} ${item.unit || ''} | Source: ${item.source || 'unknown'}`
      ).join('\n') || 'No line items available';

      // System prompt for BOM extraction
      const systemPrompt = `You are ClarityChain's BOM Extraction Engine. Extract technical specifications EXACTLY as written in documents.

CRITICAL RULES:
1. Preserve literal values with units (e.g., "1/2\"", "25mm", "14.5kg/km")
2. Do NOT convert units or standardize formats
3. Extract standards and certifications EXACTLY as written
4. Every field must cite source location (e.g., "pdf#p3", "xlsx#Sheet1!C5")
5. If data not found, use null (not empty string)
6. If conflicting values exist, list all in conflicts array

Fields to extract:
- tubes: Number of tubes (e.g., "4", "6x1.5mm")
- fibers: Fiber count or type (e.g., "24", "96F G.652D")
- outer_diameter: OD with units (e.g., "25mm", "1\"")
- weight: Weight with units (e.g., "145kg/km", "0.32lb/ft")
- bend_radius: Bend radius with units (e.g., "300mm", "12\"")
- length: Cable length (e.g., "500m", "1640ft")
- standards: Array of standards (e.g., ["DNV-ST-F119", "API 17E"])
- certifications: Array of certs (e.g., ["DNV-GL", "ISO 9001"])`;

      const userPrompt = `Extract BOM technical specifications from this supplier's data:

Supplier: ${supplier}
Document ID: ${doc.doc_id}
Currency: ${doc.currency || 'Unknown'}

Line Items:
${lineItemsContext}

Terms: ${JSON.stringify(doc.terms || {})}

EXTRACT and return JSON with this structure:
{
  "supplier": "${supplier}",
  "specs": {
    "tubes": null | string,
    "fibers": null | string,
    "outer_diameter": null | string,
    "weight": null | string,
    "bend_radius": null | string,
    "length": null | string,
    "standards": [],
    "certifications": []
  },
  "sources": {
    "tubes": "source_location",
    "fibers": "source_location",
    "outer_diameter": "source_location",
    "weight": "source_location",
    "bend_radius": "source_location",
    "length": "source_location",
    "standards": "source_location",
    "certifications": "source_location"
  },
  "conflicts": []
}

Conflicts format: [{"field": "tubes", "values": ["4", "6"], "sources": ["pdf#p1", "pdf#p3"]}]`;

      // Call AI for extraction
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
              name: 'extract_bom_specs',
              description: 'Extract technical BOM specifications',
              parameters: {
                type: 'object',
                properties: {
                  supplier: { type: 'string' },
                  specs: {
                    type: 'object',
                    properties: {
                      tubes: { type: ['string', 'null'] },
                      fibers: { type: ['string', 'null'] },
                      outer_diameter: { type: ['string', 'null'] },
                      weight: { type: ['string', 'null'] },
                      bend_radius: { type: ['string', 'null'] },
                      length: { type: ['string', 'null'] },
                      standards: { 
                        type: 'array',
                        items: { type: 'string' }
                      },
                      certifications: {
                        type: 'array',
                        items: { type: 'string' }
                      }
                    },
                    required: ['tubes', 'fibers', 'outer_diameter', 'weight', 'bend_radius', 'length', 'standards', 'certifications']
                  },
                  sources: {
                    type: 'object',
                    properties: {
                      tubes: { type: 'string' },
                      fibers: { type: 'string' },
                      outer_diameter: { type: 'string' },
                      weight: { type: 'string' },
                      bend_radius: { type: 'string' },
                      length: { type: 'string' },
                      standards: { type: 'string' },
                      certifications: { type: 'string' }
                    }
                  },
                  conflicts: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        field: { type: 'string' },
                        values: { type: 'array', items: { type: 'string' } },
                        sources: { type: 'array', items: { type: 'string' } }
                      }
                    }
                  }
                },
                required: ['supplier', 'specs', 'sources'],
                additionalProperties: false
              }
            }
          }],
          tool_choice: { type: 'function', function: { name: 'extract_bom_specs' } }
        })
      });

      if (!aiResponse.ok) {
        const errorText = await aiResponse.text();
        console.error(`[BOM] AI error for ${supplier}:`, aiResponse.status, errorText);
        
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

        // Fallback BOM data
        bomData.push({
          supplier,
          doc_id: doc.doc_id,
          specs: {
            tubes: null,
            fibers: null,
            outer_diameter: null,
            weight: null,
            bend_radius: null,
            length: null,
            standards: [],
            certifications: []
          },
          sources: {
            tubes: "[Data Gap] Extraction failed",
            fibers: "[Data Gap] Extraction failed",
            outer_diameter: "[Data Gap] Extraction failed",
            weight: "[Data Gap] Extraction failed",
            bend_radius: "[Data Gap] Extraction failed",
            length: "[Data Gap] Extraction failed",
            standards: "[Data Gap] Extraction failed",
            certifications: "[Data Gap] Extraction failed"
          },
          conflicts: [],
          error: `AI extraction failed: ${aiResponse.status}`
        });
        continue;
      }

      const aiData = await aiResponse.json();
      const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];

      if (!toolCall) {
        console.error(`[BOM] No tool call for ${supplier}`);
        bomData.push({
          supplier,
          doc_id: doc.doc_id,
          specs: {
            tubes: null,
            fibers: null,
            outer_diameter: null,
            weight: null,
            bend_radius: null,
            length: null,
            standards: [],
            certifications: []
          },
          sources: {},
          conflicts: []
        });
        continue;
      }

      const extractedBom = JSON.parse(toolCall.function.arguments);
      extractedBom.doc_id = doc.doc_id;
      bomData.push(extractedBom);

      console.log(`[BOM] Extracted specs for ${supplier}: ${extractedBom.specs.tubes || 'N/A'} tubes, ${extractedBom.specs.fibers || 'N/A'} fibers`);
    }

    // Generate summary table
    const summaryTable = bomData.map(bom => ({
      supplier: bom.supplier,
      tubes: bom.specs.tubes || "[Data Gap]",
      fibers: bom.specs.fibers || "[Data Gap]",
      od: bom.specs.outer_diameter || "[Data Gap]",
      weight: bom.specs.weight || "[Data Gap]",
      bend_radius: bom.specs.bend_radius || "[Data Gap]",
      length: bom.specs.length || "[Data Gap]",
      standards_count: bom.specs.standards?.length || 0,
      certs_count: bom.specs.certifications?.length || 0,
      has_conflicts: bom.conflicts && bom.conflicts.length > 0
    }));

    const response = {
      bom: bomData,
      summary: {
        suppliers_processed: bomData.length,
        total_conflicts: bomData.reduce((sum, b) => sum + (b.conflicts?.length || 0), 0),
        complete_specs: bomData.filter(b => 
          b.specs.tubes && b.specs.fibers && b.specs.outer_diameter
        ).length,
        table: summaryTable
      },
      metadata: {
        timestamp: new Date().toISOString()
      }
    };

    console.log(`[BOM] Extracted ${bomData.length} BOM specs, ${response.summary.total_conflicts} conflicts`);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[BOM] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'BOM extraction failed',
        bom: []
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
