import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const TCOInputSchema = z.object({
  vendor_offer_id: z.string().uuid(),
  base_price: z.number().positive(),
  logistics_cost: z.number().nonnegative().default(0),
  maintenance_cost: z.number().nonnegative().default(0),
  warranty_cost: z.number().nonnegative().default(0),
  currency: z.string().default('USD'),
  base_currency: z.string().default('USD'),
  historical_tco_records: z.array(z.object({
    date: z.string(),
    tco_value: z.number(),
    factors: z.record(z.number()).optional()
  })).optional(),
  vendor_name: z.string().optional()
});

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

    const requestBody = await req.json();
    const validatedInput = TCOInputSchema.parse(requestBody);

    console.log(`Computing TCO for vendor offer ${validatedInput.vendor_offer_id}`);

    // CRITICAL: Validate currency consistency
    if (validatedInput.currency !== validatedInput.base_currency) {
      const today = new Date().toISOString().split('T')[0];
      return new Response(JSON.stringify({
        diagnostic: true,
        blocked_reason: 'currency_mismatch',
        message: `Refusing to compute mixed-currency TCO without ECB rate ${today}.`,
        details: `Vendor currency: ${validatedInput.currency}, Base currency: ${validatedInput.base_currency}`,
        currencies: {
          vendor_currency: validatedInput.currency,
          base_currency: validatedInput.base_currency
        },
        hint: `Convert all costs to ${validatedInput.base_currency} before calling /compute-tco, or provide exchange rates.`
      }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Verify user owns this vendor offer
    const { data: vendorOffer, error: offerError } = await supabase
      .from('vendor_offers')
      .select('*, documents(*)')
      .eq('id', validatedInput.vendor_offer_id)
      .maybeSingle();

    if (offerError || !vendorOffer) {
      throw new Error('Vendor offer not found');
    }

    if (vendorOffer.documents.user_id !== user.id) {
      throw new Error('Unauthorized access to vendor offer');
    }

    // Prepare data for AI computation
    const tcoData = {
      base_price: validatedInput.base_price,
      logistics_cost: validatedInput.logistics_cost,
      maintenance_cost: validatedInput.maintenance_cost,
      warranty_cost: validatedInput.warranty_cost,
      currency: validatedInput.currency,
      base_currency: validatedInput.base_currency,
      historical_data: validatedInput.historical_tco_records || [],
      vendor_name: validatedInput.vendor_name || vendorOffer.vendor_name
    };

    // AI Prompt for TCO Calculator
    const systemPrompt = `You are the Total Cost of Ownership (TCO) Calculator for ClarityChain AI.

Your responsibilities:
1. Compute current TCO by summing all cost components
2. Apply currency conversion if needed (use latest exchange rates)
3. Normalize all costs to the base currency
4. If historical data is provided, predict TCO for next 12 months with 90% confidence interval
5. Identify key cost drivers
6. Provide a concise human-readable summary

Use realistic exchange rates and consider economic trends for predictions.`;

    const userPrompt = `Calculate TCO for the following:

Vendor: ${tcoData.vendor_name}
Base Price: ${tcoData.base_price} ${tcoData.currency}
Logistics: ${tcoData.logistics_cost} ${tcoData.currency}
Maintenance: ${tcoData.maintenance_cost} ${tcoData.currency}
Warranty: ${tcoData.warranty_cost} ${tcoData.currency}

Target Currency: ${tcoData.base_currency}

${tcoData.historical_data.length > 0 ? `Historical TCO Data: ${JSON.stringify(tcoData.historical_data)}` : 'No historical data available'}

Compute:
1. Current TCO in ${tcoData.base_currency}
2. Detailed cost breakdown
3. If historical data exists, predict 12-month TCO with confidence intervals
4. Identify key cost drivers
5. Provide one-sentence summary`;

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
            name: 'compute_tco',
            description: 'Compute Total Cost of Ownership with predictions',
            parameters: {
              type: 'object',
              properties: {
                current_tco: {
                  type: 'number',
                  description: 'Current TCO in base currency'
                },
                breakdown: {
                  type: 'object',
                  properties: {
                    base_price: { type: 'number', description: 'Base price in base currency' },
                    logistics: { type: 'number', description: 'Logistics cost in base currency' },
                    maintenance: { type: 'number', description: 'Maintenance cost in base currency' },
                    warranty: { type: 'number', description: 'Warranty cost in base currency' }
                  },
                  required: ['base_price', 'logistics', 'maintenance', 'warranty']
                },
                currency_info: {
                  type: 'object',
                  properties: {
                    original_currency: { type: 'string' },
                    base_currency: { type: 'string' },
                    exchange_rate: { type: 'number', description: 'Exchange rate applied' },
                    conversion_applied: { type: 'boolean' }
                  }
                },
                predicted_tco_next_12m: {
                  type: 'number',
                  description: 'Predicted TCO for next 12 months (null if no historical data)'
                },
                confidence_interval: {
                  type: 'object',
                  properties: {
                    lower: { type: 'number', description: '5th percentile (90% CI lower bound)' },
                    upper: { type: 'number', description: '95th percentile (90% CI upper bound)' }
                  },
                  description: 'Confidence interval for prediction (null if no prediction)'
                },
                key_drivers: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      component: { type: 'string', enum: ['base_price', 'logistics', 'maintenance', 'warranty'] },
                      percentage_of_total: { type: 'number' },
                      trend: { type: 'string', enum: ['stable', 'increasing', 'decreasing'] }
                    }
                  },
                  description: 'Key cost drivers sorted by impact'
                },
                summary: {
                  type: 'string',
                  description: 'One-sentence human-readable summary'
                },
                prediction_methodology: {
                  type: 'string',
                  description: 'Methodology used for prediction (e.g., Linear Regression, Trend Analysis)'
                }
              },
              required: ['current_tco', 'breakdown', 'currency_info', 'key_drivers', 'summary'],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'compute_tco' } }
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

    const tcoResult = JSON.parse(toolCall.function.arguments);

    // Store TCO calculation in database
    const { data: tcoRecord, error: insertError } = await supabase
      .from('tco_calculations')
      .insert({
        vendor_offer_id: validatedInput.vendor_offer_id,
        calculated_tco: tcoResult.current_tco,
        breakdown: tcoResult.breakdown,
        calculation_method: tcoResult.prediction_methodology || 'standard'
      })
      .select()
      .single();

    if (insertError) {
      console.error('Error storing TCO calculation:', insertError);
      // Continue even if storage fails
    }

    console.log(`TCO computed: ${tcoResult.current_tco} ${tcoData.base_currency}`);

    return new Response(
      JSON.stringify({
        success: true,
        tco: {
          ...tcoResult,
          vendor_name: tcoData.vendor_name,
          vendor_offer_id: validatedInput.vendor_offer_id,
          calculation_id: tcoRecord?.id,
          calculated_at: new Date().toISOString()
        },
        message: 'TCO computed successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('TCO computation error:', error);
    
    if (error instanceof z.ZodError) {
      return new Response(
        JSON.stringify({ 
          error: 'Invalid input',
          details: error.errors 
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 400 
        }
      );
    }

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
