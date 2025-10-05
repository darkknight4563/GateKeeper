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

    const { job_id, metric_weights } = await req.json();

    if (!job_id) {
      throw new Error('Missing required field: job_id');
    }

    console.log(`Generating comparison layout for job ${job_id}`);

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

    if (!vendors || vendors.length === 0) {
      throw new Error('No vendor data found');
    }

    // Prepare supplier data for AI
    const supplierData = vendors.map(v => ({
      name: v.vendor_name,
      price: v.quoted_price,
      currency: v.currency,
      tco: v.tco_calculations?.[0]?.calculated_tco || v.quoted_price,
      risk_score: v.risk_assessments?.[0]?.risk_score || 0,
      lead_time: v.lead_time_analysis?.[0]?.estimated_lead_time || 0,
      items_count: v.items_count,
      extracted_data: v.extracted_data || {}
    }));

    // AI Prompt for Layout Designer
    const systemPrompt = `You are the Layout Designer for ClarityChain AI.

Your goal is to transform vendor data into a structured side-by-side comparison that highlights key differences.

You must:
1. Build a uniform comparison schema for each metric (price, risk, delivery, TCO, etc.)
2. Arrange metrics as comparable data points across suppliers
3. Highlight the best-performing supplier for each metric
4. Create a concise markdown summary table
5. Provide an overall recommendation

Return structured data that can be used for UI rendering AND a markdown summary for quick viewing.`;

    const userPrompt = `Create a side-by-side comparison layout for these suppliers:

${JSON.stringify(supplierData, null, 2)}

${metric_weights ? `Metric weights: ${JSON.stringify(metric_weights)}` : 'Use standard metric importance'}

Generate:
1. Comparison schema with all metrics
2. Markdown summary table
3. Overall recommendation based on cost-to-risk balance`;

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
            name: 'generate_comparison_layout',
            description: 'Generate structured side-by-side comparison layout',
            parameters: {
              type: 'object',
              properties: {
                metrics: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      metric: { type: 'string', description: 'Metric name (e.g., Price, Risk Score, Lead Time)' },
                      unit: { type: 'string', description: 'Unit of measurement (e.g., USD, weeks, score)' },
                      suppliers: {
                        type: 'array',
                        items: {
                          type: 'object',
                          properties: {
                            name: { type: 'string' },
                            value: { type: 'number' },
                            display_value: { type: 'string', description: 'Formatted display value' },
                            is_best: { type: 'boolean', description: 'True if this is the best value for this metric' }
                          },
                          required: ['name', 'value', 'display_value']
                        }
                      },
                      best_supplier: { type: 'string', description: 'Name of best performing supplier for this metric' },
                      direction: { 
                        type: 'string', 
                        enum: ['lower_is_better', 'higher_is_better'],
                        description: 'Whether lower or higher values are better'
                      }
                    },
                    required: ['metric', 'unit', 'suppliers', 'best_supplier', 'direction']
                  }
                },
                markdown_summary: {
                  type: 'string',
                  description: 'Markdown formatted comparison table with highlights'
                },
                overall_recommendation: {
                  type: 'object',
                  properties: {
                    recommended_supplier: { type: 'string' },
                    reasoning: { type: 'string' },
                    cost_to_risk_balance: { type: 'string' }
                  },
                  required: ['recommended_supplier', 'reasoning']
                },
                comparison_highlights: {
                  type: 'array',
                  items: {
                    type: 'string',
                    description: 'Key comparison insights'
                  }
                }
              },
              required: ['metrics', 'markdown_summary', 'overall_recommendation'],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'generate_comparison_layout' } }
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

    const comparisonLayout = JSON.parse(toolCall.function.arguments);

    // Add metadata
    const result = {
      ...comparisonLayout,
      metadata: {
        job_id,
        document_name: job.documents.filename,
        suppliers_count: vendors.length,
        generated_at: new Date().toISOString(),
        metric_weights: metric_weights || null
      }
    };

    console.log(`Comparison layout generated successfully with ${result.metrics.length} metrics`);

    return new Response(
      JSON.stringify({
        success: true,
        comparison: result,
        message: 'Comparison layout generated successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Comparison layout error:', error);
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
