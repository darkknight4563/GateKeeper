import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { z } from "https://deno.land/x/zod@v3.22.4/mod.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const ConversionRequestSchema = z.object({
  value: z.number(),
  source_currency: z.string().length(3).toUpperCase(),
  target_currency: z.string().length(3).toUpperCase(),
  conversion_date: z.string().optional(),
  rate_source: z.enum(['ECB', 'IMF', 'AUTO']).default('AUTO')
});

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY');

    if (!lovableApiKey) {
      throw new Error('LOVABLE_API_KEY not configured');
    }

    const requestBody = await req.json();
    const validatedInput = ConversionRequestSchema.parse(requestBody);

    console.log(`Converting ${validatedInput.value} ${validatedInput.source_currency} to ${validatedInput.target_currency}`);

    // If source and target are the same, return immediately
    if (validatedInput.source_currency === validatedInput.target_currency) {
      return new Response(
        JSON.stringify({
          success: true,
          conversion: {
            converted_value: validatedInput.value,
            exchange_rate: 1.0,
            date_used: validatedInput.conversion_date || new Date().toISOString().split('T')[0],
            source: 'NO_CONVERSION_NEEDED',
            original_value: validatedInput.value,
            source_currency: validatedInput.source_currency,
            target_currency: validatedInput.target_currency
          }
        }),
        { 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
          status: 200 
        }
      );
    }

    // AI Prompt for Currency Conversion
    const systemPrompt = `You are the Currency Conversion and Normalization module for ClarityChain AI.

You have access to current and historical exchange rates from ECB (European Central Bank) and IMF (International Monetary Fund).

Your responsibilities:
1. Provide accurate exchange rates for currency conversion
2. Use the most recent available data if no specific date is provided
3. Handle major currencies (USD, EUR, GBP, NOK, JPY, CNY, etc.)
4. Account for cross-currency conversions
5. Provide metadata about rate source and date

Always use realistic, market-based exchange rates.`;

    const conversionDate = validatedInput.conversion_date || new Date().toISOString().split('T')[0];

    const userPrompt = `Convert currency:

Value: ${validatedInput.value}
From: ${validatedInput.source_currency}
To: ${validatedInput.target_currency}
Date: ${conversionDate}
Preferred Rate Source: ${validatedInput.rate_source}

Provide the exchange rate and converted value. Use current market rates if date is today, otherwise use historical rates.`;

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
            name: 'convert_currency',
            description: 'Convert currency using exchange rates',
            parameters: {
              type: 'object',
              properties: {
                converted_value: {
                  type: 'number',
                  description: 'Value after currency conversion'
                },
                exchange_rate: {
                  type: 'number',
                  description: 'Exchange rate used (source to target)'
                },
                date_used: {
                  type: 'string',
                  description: 'Date of exchange rate (YYYY-MM-DD)'
                },
                source: {
                  type: 'string',
                  enum: ['ECB', 'IMF', 'MARKET_DATA'],
                  description: 'Source of exchange rate'
                },
                calculation_details: {
                  type: 'object',
                  properties: {
                    formula: { type: 'string', description: 'Conversion formula used' },
                    intermediate_currency: { 
                      type: 'string', 
                      description: 'Intermediate currency if cross-rate used (e.g., USD)'
                    },
                    rate_reliability: {
                      type: 'string',
                      enum: ['official', 'estimated', 'historical'],
                      description: 'Reliability of the rate'
                    }
                  }
                },
                original_value: {
                  type: 'number',
                  description: 'Original value before conversion'
                },
                source_currency: {
                  type: 'string',
                  description: 'Source currency code'
                },
                target_currency: {
                  type: 'string',
                  description: 'Target currency code'
                }
              },
              required: [
                'converted_value',
                'exchange_rate',
                'date_used',
                'source',
                'original_value',
                'source_currency',
                'target_currency'
              ],
              additionalProperties: false
            }
          }
        }],
        tool_choice: { type: 'function', function: { name: 'convert_currency' } }
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

    const conversionResult = JSON.parse(toolCall.function.arguments);

    console.log(`Conversion complete: ${validatedInput.value} ${validatedInput.source_currency} = ${conversionResult.converted_value} ${validatedInput.target_currency} (rate: ${conversionResult.exchange_rate})`);

    return new Response(
      JSON.stringify({
        success: true,
        conversion: conversionResult,
        message: 'Currency conversion completed successfully'
      }),
      { 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200 
      }
    );

  } catch (error) {
    console.error('Currency conversion error:', error);
    
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
