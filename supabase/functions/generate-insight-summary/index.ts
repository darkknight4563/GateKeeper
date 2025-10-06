import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const { winner, avgTCO, highRiskCount, totalVendors, totalSavings, currency = 'EUR' } = await req.json();

    console.log('Generating insight summary for:', { winner, avgTCO, highRiskCount, totalVendors, totalSavings, currency });

    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    if (!LOVABLE_API_KEY) {
      throw new Error('LOVABLE_API_KEY is not configured');
    }

    // Format currency for the prompt
    const formatCurrency = (amount: number) => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency,
        minimumFractionDigits: 0,
        maximumFractionDigits: 0,
      }).format(amount);
    };

    const prompt = `You are a procurement analyst writing an executive insight summary for a vendor comparison report.

Based on the following data, write a concise, professional 2-3 sentence summary that highlights the key findings:

- Winning Vendor: ${winner}
- Average TCO across all vendors: ${formatCurrency(avgTCO)}
- Total vendors analyzed: ${totalVendors}
- High-risk vendors identified: ${highRiskCount}
- Potential savings vs worst option: ${formatCurrency(totalSavings)}

Requirements:
- Be concise and professional
- Highlight the winner and key savings
- Mention risk factors if significant (high risk count > 0)
- Use clear, actionable language
- 2-3 sentences maximum
- Do not use bullet points or headings, just a flowing paragraph`;

    const response = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: 'You are a procurement analyst expert at writing clear, concise executive summaries.' },
          { role: 'user', content: prompt }
        ],
        temperature: 0.7,
        max_tokens: 200,
      }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        return new Response(JSON.stringify({ error: 'Rate limits exceeded, please try again later.' }), {
          status: 429,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      if (response.status === 402) {
        return new Response(JSON.stringify({ error: 'Payment required, please add funds to your Lovable AI workspace.' }), {
          status: 402,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
      const errorText = await response.text();
      console.error('AI gateway error:', response.status, errorText);
      throw new Error(`AI gateway error: ${response.status}`);
    }

    const data = await response.json();
    const summary = data.choices?.[0]?.message?.content || 'Unable to generate summary at this time.';

    console.log('Generated summary:', summary);

    return new Response(JSON.stringify({ summary }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in generate-insight-summary:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      summary: 'Analysis complete. Please review the detailed vendor comparison below for comprehensive insights.'
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
