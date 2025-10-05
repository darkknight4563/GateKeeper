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

    console.log(`Generating executive summary for job ${job_id}`);

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

    // Fetch all vendor data with related analytics
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

    // Fetch approval workflows
    const { data: workflows, error: workflowsError } = await supabase
      .from('approval_workflows')
      .select('*')
      .eq('document_id', job.document_id);

    if (workflowsError) {
      console.error('Error fetching workflows:', workflowsError);
    }

    // Prepare data for summary
    const summaryData = {
      document_name: job.documents.filename,
      vendors: vendors?.map(v => ({
        name: v.vendor_name,
        quoted_price: v.quoted_price,
        currency: v.currency,
        tco: v.tco_calculations?.[0]?.calculated_tco || v.quoted_price,
        tco_breakdown: v.tco_calculations?.[0]?.breakdown,
        risk_score: v.risk_assessments?.[0]?.risk_score || 0,
        risk_factors: v.risk_assessments?.[0]?.risk_factors || [],
        lead_time: v.lead_time_analysis?.[0]?.estimated_lead_time || 0,
        items_count: v.items_count
      })) || [],
      pending_approvals: workflows?.filter(w => w.current_state === 'pending').length || 0,
      approval_status: workflows?.map(w => ({
        supplier: w.supplier_name,
        state: w.current_state
      })) || []
    };

    // AI Prompt for Executive Summary
    const systemPrompt = `You are an Executive Report Writer for ClarityChain AI.

Generate concise, professional executive summaries suitable for board reports and leadership dashboards.

Your summaries must:
- Be under 200 words
- Use professional, factual tone
- Highlight key decision points
- Be actionable and clear
- Focus on business impact

Structure your summary to include:
1. Top-performing supplier(s) with key metrics
2. Main cost and risk differentiators
3. TCO overview with trends
4. Pending approvals and key actions`;

    const userPrompt = `Generate an executive summary for this procurement analysis:

Document: ${summaryData.document_name}
Vendors Analyzed: ${summaryData.vendors.length}
Pending Approvals: ${summaryData.pending_approvals}

Vendor Details:
${JSON.stringify(summaryData.vendors, null, 2)}

Approval Status:
${JSON.stringify(summaryData.approval_status, null, 2)}

Create a professional, concise executive summary under 200 words.`;

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
            name: 'generate_executive_summary',
            description: 'Generate executive summary for procurement analysis',
            parameters: {
              type: 'object',
              properties: {
                summary_text: {
                  type: 'string',
                  description: 'Full executive summary text (under 200 words)'
                },
                top_suppliers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      name: { type: 'string' },
                      rank: { type: 'number' },
                      key_strength: { type: 'string' },
                      tco: { type: 'number' },
                      risk_level: { type: 'string', enum: ['low', 'medium', 'high'] }
                    }
                  },
                  description: 'Top 3 performing suppliers'
                },
                cost_differentiators: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Key cost differences between suppliers'
                },
                risk_differentiators: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Key risk differences between suppliers'
                },
                tco_overview: {
                  type: 'object',
                  properties: {
                    range: {
                      type: 'object',
                      properties: {
                        lowest: { type: 'number' },
                        highest: { type: 'number' },
                        average: { type: 'number' }
                      }
                    },
                    trend: { type: 'string', description: 'Predicted trend direction' },
                    key_insight: { type: 'string' }
                  }
                },
                key_actions: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      action: { type: 'string' },
                      priority: { type: 'string', enum: ['critical', 'high', 'medium', 'low'] },
                      status: { type: 'string', enum: ['pending', 'in_progress', 'completed'] }
                    }
                  },
                  description: 'Pending actions requiring attention'
                },
                recommendation: {
                  type: 'string',
                  description: 'Primary recommendation for leadership'
                },
                word_count: {
                  type: 'number',
                  description: 'Actual word count of summary'
                }
              },
              required: [
                'summary_text',
                'top_suppliers',
                'cost_differentiators',
                'risk_differentiators',
                'tco_overview',
                'key_actions',
                'recommendation'
              ],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'generate_executive_summary' } }
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

    const executiveSummary = JSON.parse(toolCall.function.arguments);

    // Add metadata
    const result = {
      ...executiveSummary,
      metadata: {
        job_id,
        document_name: job.documents.filename,
        vendors_analyzed: summaryData.vendors.length,
        pending_approvals: summaryData.pending_approvals,
        generated_at: new Date().toISOString(),
        generated_for: user.email || user.id
      }
    };

    console.log(`Executive summary generated (${executiveSummary.word_count || 0} words)`);

    return new Response(
      JSON.stringify({
        success: true,
        summary: result,
        message: 'Executive summary generated successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Executive summary error:', error);
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
