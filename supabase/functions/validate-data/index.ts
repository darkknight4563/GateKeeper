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

    console.log(`Performing QA validation for job ${job_id}`);

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
      .eq('document_id', job.document_id);

    if (vendorsError) {
      throw new Error('Failed to fetch vendor data');
    }

    // Prepare data for validation
    const validationData = vendors?.map(v => ({
      vendor_id: v.id,
      vendor_name: v.vendor_name,
      quoted_price: v.quoted_price,
      currency: v.currency,
      items_count: v.items_count,
      tco: v.tco_calculations?.[0]?.calculated_tco,
      tco_breakdown: v.tco_calculations?.[0]?.breakdown,
      risk_score: v.risk_assessments?.[0]?.risk_score,
      risk_factors: v.risk_assessments?.[0]?.risk_factors,
      lead_time: v.lead_time_analysis?.[0]?.estimated_lead_time,
      extracted_data: v.extracted_data
    })) || [];

    // AI Prompt for Analyst QA
    const systemPrompt = `You are the Quality Assurance Analyst for ClarityChain AI.

Perform comprehensive validation on procurement analysis data before report generation.

Validation rules:
1. All numeric fields (prices, TCO, lead times) must be > 0
2. Risk scores must be between 0 and 10
3. TCO calculations must sum correctly from breakdown components
4. Required fields must not be missing (currency codes, vendor names)
5. Delivery/lead time dates must be realistic (not in the past, not too far in future)
6. Currency codes must be valid 3-letter ISO codes

Return a detailed validation report with all issues found.`;

    const userPrompt = `Validate this vendor analysis data:

${JSON.stringify(validationData, null, 2)}

Perform sanity checks on:
1. All numeric values are positive
2. Risk scores are valid (0-10 range)
3. TCO breakdown sums match calculated TCO
4. No missing required fields (currency, vendor name, etc.)
5. Delivery dates are reasonable
6. Data consistency across all vendors

Report all validation issues found.`;

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
            name: 'validate_vendor_data',
            description: 'Perform QA validation on vendor analysis data',
            parameters: {
              type: 'object',
              properties: {
                valid: {
                  type: 'boolean',
                  description: 'True if all validations pass, false if any issues found'
                },
                validation_score: {
                  type: 'number',
                  description: 'Overall validation score 0-100'
                },
                issues: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      vendor_id: { type: 'string', description: 'ID of vendor with issue (if applicable)' },
                      vendor_name: { type: 'string', description: 'Name of vendor with issue' },
                      severity: { 
                        type: 'string', 
                        enum: ['critical', 'high', 'medium', 'low'],
                        description: 'Severity of the issue'
                      },
                      category: {
                        type: 'string',
                        enum: ['numeric_validation', 'missing_data', 'calculation_error', 'data_consistency', 'invalid_value'],
                        description: 'Category of validation issue'
                      },
                      field: { type: 'string', description: 'Field with the issue' },
                      message: { type: 'string', description: 'Human-readable issue description' },
                      current_value: { description: 'Current problematic value' },
                      expected_value: { description: 'Expected value or range' }
                    },
                    required: ['severity', 'category', 'message']
                  },
                  description: 'List of validation issues found'
                },
                checks_performed: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      check_name: { type: 'string' },
                      passed: { type: 'boolean' },
                      vendors_affected: { type: 'number' }
                    }
                  },
                  description: 'Summary of all validation checks'
                },
                warnings: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Non-critical warnings'
                },
                recommendations: {
                  type: 'array',
                  items: { type: 'string' },
                  description: 'Recommendations to fix issues'
                },
                can_proceed_to_export: {
                  type: 'boolean',
                  description: 'Whether data is ready for export (no critical issues)'
                }
              },
              required: ['valid', 'validation_score', 'issues', 'checks_performed', 'can_proceed_to_export'],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'validate_vendor_data' } }
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

    const validationResult = JSON.parse(toolCall.function.arguments);

    // Add metadata
    const result = {
      ...validationResult,
      metadata: {
        job_id,
        document_name: job.documents.filename,
        vendors_validated: validationData.length,
        validated_at: new Date().toISOString(),
        validator: 'ClarityChain QA Analyst'
      }
    };

    const criticalIssues = validationResult.issues?.filter((i: any) => i.severity === 'critical').length || 0;
    
    console.log(`Validation complete: ${validationResult.valid ? 'PASSED' : 'FAILED'} (Score: ${validationResult.validation_score}/100, ${validationResult.issues?.length || 0} issues, ${criticalIssues} critical)`);

    return new Response(
      JSON.stringify({
        success: true,
        validation: result,
        message: validationResult.valid 
          ? 'All validations passed' 
          : `Validation failed with ${validationResult.issues?.length || 0} issue(s)`
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Validation error:', error);
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
