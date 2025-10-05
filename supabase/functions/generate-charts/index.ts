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

    const { job_id } = await req.json();

    if (!job_id) {
      throw new Error('Missing required field: job_id');
    }

    console.log(`Generating chart specs for job ${job_id}`);

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

    if (vendorsError || !vendors || vendors.length === 0) {
      throw new Error('No vendor data found');
    }

    // Prepare vendor data for visualization
    const chartData = vendors.map(v => ({
      name: v.vendor_name,
      quoted_price: v.quoted_price,
      currency: v.currency,
      tco: v.tco_calculations?.[0]?.calculated_tco || v.quoted_price,
      tco_breakdown: v.tco_calculations?.[0]?.breakdown || {},
      risk_score: v.risk_assessments?.[0]?.risk_score || 0,
      risk_factors: v.risk_assessments?.[0]?.risk_factors || [],
      lead_time: v.lead_time_analysis?.[0]?.estimated_lead_time || 0
    }));

    // AI Prompt for Visualization Planner
    const systemPrompt = `You are the Visualization Planner for ClarityChain AI.

Generate visualization specifications for Recharts library in React.

Your output must be directly usable with Recharts components without modification.

Create specs for:
1. Bar chart - Price and TCO comparison
2. Radar chart - Multi-dimensional risk analysis
3. Line chart - TCO projections over time
4. Additional charts as needed for comprehensive vendor comparison

Use standard Recharts data structures and ensure all values are numeric where expected.`;

    const userPrompt = `Generate chart specifications for these vendors:

${JSON.stringify(chartData, null, 2)}

Create:
1. Bar chart comparing prices and TCO across vendors
2. Radar chart showing risk dimensions for each vendor
3. Line chart projecting TCO trends (12-month forecast)
4. Any additional charts that would help decision-making

Ensure all data is properly formatted for Recharts.`;

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
            name: 'generate_chart_specs',
            description: 'Generate Recharts-compatible visualization specifications',
            parameters: {
              type: 'object',
              properties: {
                charts: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      id: { type: 'string', description: 'Unique chart identifier' },
                      type: { 
                        type: 'string', 
                        enum: ['bar', 'radar', 'line', 'pie', 'area', 'scatter'],
                        description: 'Chart type'
                      },
                      title: { type: 'string', description: 'Chart title' },
                      description: { type: 'string', description: 'Chart description' },
                      metric: { type: 'string', description: 'Primary metric being visualized' },
                      data: {
                        type: 'array',
                        description: 'Chart data in Recharts format'
                      },
                      config: {
                        type: 'object',
                        properties: {
                          xAxisKey: { type: 'string', description: 'X-axis data key' },
                          yAxisKey: { type: 'string', description: 'Y-axis data key' },
                          dataKeys: { 
                            type: 'array', 
                            items: { type: 'string' },
                            description: 'Data keys for multiple series'
                          },
                          colors: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'Colors for chart elements (hex codes)'
                          },
                          formatters: {
                            type: 'object',
                            description: 'Value formatters (e.g., currency, percentage)'
                          }
                        }
                      }
                    },
                    required: ['id', 'type', 'title', 'metric', 'data', 'config']
                  }
                },
                summary: {
                  type: 'object',
                  properties: {
                    total_charts: { type: 'number' },
                    key_insights: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Key insights from visualizations'
                    },
                    recommended_view_order: {
                      type: 'array',
                      items: { type: 'string' },
                      description: 'Recommended order for viewing charts'
                    }
                  }
                }
              },
              required: ['charts', 'summary'],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'generate_chart_specs' } }
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

    const chartSpecs = JSON.parse(toolCall.function.arguments);

    // Add metadata
    const result = {
      ...chartSpecs,
      metadata: {
        job_id,
        document_name: job.documents.filename,
        vendors_count: vendors.length,
        generated_at: new Date().toISOString()
      }
    };

    console.log(`Generated ${chartSpecs.charts.length} chart specifications`);

    return new Response(
      JSON.stringify({
        success: true,
        visualizations: result,
        message: 'Chart specifications generated successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Chart generation error:', error);
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
