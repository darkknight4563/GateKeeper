import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      throw new Error('Missing authorization header');
    }

    const { data: { user }, error: authError } = await supabase.auth.getUser(
      authHeader.replace('Bearer ', '')
    );

    if (authError || !user) {
      throw new Error('Unauthorized');
    }

    const { 
      job_id, 
      format, 
      selected_suppliers,
      company_logo,
      header_template,
      footer_template 
    } = await req.json();

    if (!job_id || !format) {
      throw new Error('Missing required fields: job_id and format');
    }

    if (!['pdf', 'docx', 'xlsx'].includes(format)) {
      throw new Error('Invalid format. Must be pdf, docx, or xlsx');
    }

    console.log(`Generating ${format} export for job ${job_id}`);

    // Fetch job data
    const { data: job, error: jobError } = await supabase
      .from('processing_jobs')
      .select('*, documents(*)')
      .eq('id', job_id)
      .single();

    if (jobError || !job) {
      throw new Error('Job not found');
    }

    // Verify user owns this document
    if (job.documents.user_id !== user.id) {
      throw new Error('Unauthorized access to document');
    }

    // Fetch vendor offers with related data
    const { data: vendors, error: vendorsError } = await supabase
      .from('vendor_offers')
      .select(`
        *,
        tco_calculations(*),
        risk_assessments(*),
        lead_time_analysis(*)
      `)
      .eq('document_id', job.document_id)
      .order('quoted_price', { ascending: true });

    if (vendorsError) {
      throw new Error('Failed to fetch vendor data');
    }

    // Filter by selected suppliers if provided
    let filteredVendors = vendors || [];
    if (selected_suppliers && selected_suppliers.length > 0) {
      filteredVendors = filteredVendors.filter(v => 
        selected_suppliers.includes(v.vendor_name)
      );
    }

    // Prepare structured analysis data
    const analysisData = {
      job_id,
      document_name: job.documents.filename,
      vendors: filteredVendors.map(v => ({
        name: v.vendor_name,
        quoted_price: v.quoted_price,
        currency: v.currency,
        items_count: v.items_count,
        tco: v.tco_calculations?.[0]?.calculated_tco || v.quoted_price,
        tco_breakdown: v.tco_calculations?.[0]?.breakdown || {},
        risk_score: v.risk_assessments?.[0]?.risk_score || 0,
        risk_factors: v.risk_assessments?.[0]?.risk_factors || [],
        lead_time: v.lead_time_analysis?.[0]?.estimated_lead_time || 0,
        lead_time_factors: v.lead_time_analysis?.[0]?.factors || {},
        extracted_data: v.extracted_data || {}
      }))
    };

    // AI Prompt for Export Engine
    const systemPrompt = `You are the Export Engine for ClarityChain AI.

You generate structured export data for procurement analysis reports in various formats.

Your task:
1. Produce an exportable representation of the procurement analysis report.
2. Preserve editable table formats for quantities, prices, and risks.
3. Include the following sections:
   - Executive Summary (key findings and recommendation)
   - Vendor Comparison Table (side-by-side comparison)
   - Risk Explanation Table (detailed risk factors)
   - TCO Breakdown (total cost of ownership details)
   - Action Points (next steps and recommendations)

Format-specific instructions:
- For PDF: Create final design layout with clear visual hierarchy
- For DOCX: Keep editable cells and headings, use table format
- For XLSX: Use cell formulas for subtotals and currency conversion

Output must be structured JSON that can be used to generate the final export file.`;

    const userPrompt = `Generate a ${format.toUpperCase()} export structure for the following procurement analysis:

Document: ${analysisData.document_name}
Number of Vendors: ${analysisData.vendors.length}

Vendor Data:
${JSON.stringify(analysisData.vendors, null, 2)}

Company branding:
- Logo: ${company_logo ? 'Provided' : 'Not provided'}
- Header template: ${header_template ? 'Provided' : 'Default'}
- Footer template: ${footer_template ? 'Provided' : 'Default'}

Generate a complete export structure with all required sections.`;

    // Call Lovable AI with tool calling for structured output
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
            name: 'generate_export_structure',
            description: 'Generate structured export data for procurement reports',
            parameters: {
              type: 'object',
              properties: {
                format: {
                  type: 'string',
                  enum: ['pdf', 'docx', 'xlsx'],
                  description: 'Export format'
                },
                file_name: {
                  type: 'string',
                  description: 'Generated file name'
                },
                sections_included: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'List of included sections'
                },
                executive_summary: {
                  type: 'object',
                  properties: {
                    key_findings: { type: 'array', items: { type: 'string' } },
                    recommendation: { type: 'string' },
                    total_vendors_analyzed: { type: 'number' }
                  }
                },
                tables: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      title: { type: 'string' },
                      headers: { type: 'array', items: { type: 'string' } },
                      rows: {
                        type: 'array',
                        items: {
                          type: 'array',
                          items: { type: 'string' }
                        }
                      },
                      formulas: {
                        type: 'object',
                        description: 'Excel formulas for XLSX format'
                      }
                    }
                  }
                },
                action_points: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      priority: { type: 'string', enum: ['high', 'medium', 'low'] },
                      action: { type: 'string' },
                      assignee: { type: 'string' },
                      deadline: { type: 'string' }
                    }
                  }
                },
                metadata: {
                  type: 'object',
                  properties: {
                    generated_at: { type: 'string' },
                    generated_by: { type: 'string' },
                    document_source: { type: 'string' }
                  }
                }
              },
              required: ['format', 'file_name', 'sections_included', 'executive_summary', 'tables'],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'generate_export_structure' } }
      })
    });

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text();
      console.error('AI API error:', aiResponse.status, errorText);
      throw new Error(`AI API error: ${aiResponse.status}`);
    }

    const aiData = await aiResponse.json();
    console.log('AI response received');

    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0];
    if (!toolCall) {
      throw new Error('No tool call in AI response');
    }

    const exportStructure = JSON.parse(toolCall.function.arguments);

    // Add metadata
    exportStructure.metadata = {
      ...exportStructure.metadata,
      generated_at: new Date().toISOString(),
      generated_by: user.email || user.id,
      document_source: job.documents.filename,
      job_id: job_id
    };

    console.log(`Export structure generated successfully for format: ${format}`);

    return new Response(
      JSON.stringify({
        success: true,
        export_structure: exportStructure,
        message: `${format.toUpperCase()} export structure generated successfully`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Export error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Unknown error occurred' 
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 400 
      }
    );
  }
});
