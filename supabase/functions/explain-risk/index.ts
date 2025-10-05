import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ExplainabilityResponseSchema = z.object({
  explanation: z.string(),
  sources: z.array(z.string()),
  recommendation: z.string(),
  factor_breakdown: z.array(z.object({
    factor: z.string(),
    contribution: z.string(),
    impact: z.string(),
  })).optional(),
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!

    const supabase = createClient(supabaseUrl, supabaseKey)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { supplier, risk_score, risk_assessment_id, vendor_offer_id } = await req.json()

    if (!supplier || risk_score === undefined) {
      return new Response(
        JSON.stringify({ error: 'supplier and risk_score are required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Explaining risk score for:', supplier, 'Score:', risk_score)

    // Retrieve risk assessment data from database
    let riskData: any = null
    let vendorData: any = null
    let tcoData: any = null
    let leadTimeData: any = null

    if (risk_assessment_id) {
      const { data: risk } = await supabase
        .from('risk_assessments')
        .select('*')
        .eq('id', risk_assessment_id)
        .single()
      
      riskData = risk
    } else if (vendor_offer_id) {
      const { data: risk } = await supabase
        .from('risk_assessments')
        .select('*')
        .eq('vendor_offer_id', vendor_offer_id)
        .single()
      
      riskData = risk
    }

    // Get vendor offer details
    if (vendor_offer_id) {
      const { data: vendor } = await supabase
        .from('vendor_offers')
        .select('*')
        .eq('id', vendor_offer_id)
        .single()
      
      vendorData = vendor

      // Get TCO data
      const { data: tco } = await supabase
        .from('tco_calculations')
        .select('*')
        .eq('vendor_offer_id', vendor_offer_id)
        .single()
      
      tcoData = tco

      // Get lead time data
      const { data: leadTime } = await supabase
        .from('lead_time_analysis')
        .select('*')
        .eq('vendor_offer_id', vendor_offer_id)
        .single()
      
      leadTimeData = leadTime
    }

    console.log('Retrieved data:', {
      riskData: !!riskData,
      vendorData: !!vendorData,
      tcoData: !!tcoData,
      leadTimeData: !!leadTimeData
    })

    // Build explainability prompt
    const explainabilityPrompt = `You are the Explainability Engine for ClarityChain AI.

Task:
Given a supplier and risk score, retrieve and describe the top contributing factors.

Supplier: ${supplier}
Risk Score: ${risk_score}/10

Available Data:
${JSON.stringify({
  risk_assessment: riskData,
  vendor_offer: vendorData,
  tco_calculation: tcoData,
  lead_time_analysis: leadTimeData
}, null, 2)}

Instructions:
- Summarize how these factors combine into the score
- Explain what could lower the score (e.g., "If delivery improves below 35 weeks, risk falls to ~5/10.")
- Cite data sources explicitly
- Break down each contributing factor and its impact

Return ONLY this JSON structure:
{
  "explanation": "Clear summary of why the risk score is ${risk_score}/10",
  "sources": ["Source1", "Source2", ...],
  "recommendation": "Specific advice on how to lower the risk score",
  "factor_breakdown": [
    {
      "factor": "Factor name",
      "contribution": "How much this affects the score (e.g., +2 points)",
      "impact": "Description of the impact"
    }
  ]
}

Example explanation format:
"Risk ${risk_score}/10 due to moderate price fluctuation (12%) and longer delivery time (44 weeks). The price variance contributes approximately 2.5 points to the risk score, while delivery reliability adds 2.1 points."

Example recommendation format:
"If delivery time improves below 35 weeks, risk could fall to approximately 5/10. Securing fixed-price contracts would reduce price variance risk by 1.5 points."

Return ONLY valid JSON.`

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { 
            role: 'system', 
            content: 'You are an explainability engine. Always return valid JSON only, no markdown formatting.' 
          },
          { role: 'user', content: explainabilityPrompt }
        ],
      }),
    })

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error('Lovable AI error:', aiResponse.status, errorText)
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded, please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required, please add funds to your Lovable AI workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      throw new Error(`AI explainability failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    const explainabilityContent = aiResult.choices[0]?.message?.content

    if (!explainabilityContent) {
      throw new Error('No explanation generated from AI response')
    }

    console.log('Raw AI explainability response:', explainabilityContent)

    // Parse and validate the JSON response
    let explainabilityData
    try {
      const jsonMatch = explainabilityContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : explainabilityContent
      const parsedData = JSON.parse(jsonStr.trim())
      
      // Validate against schema
      const validationResult = ExplainabilityResponseSchema.safeParse(parsedData)
      
      if (!validationResult.success) {
        console.warn('Schema validation failed:', validationResult.error.errors)
        // Provide defaults if validation fails
        explainabilityData = {
          explanation: parsedData.explanation || `Risk score of ${risk_score}/10 for ${supplier}`,
          sources: Array.isArray(parsedData.sources) ? parsedData.sources : [],
          recommendation: parsedData.recommendation || 'Review vendor performance metrics',
          factor_breakdown: parsedData.factor_breakdown || []
        }
      } else {
        explainabilityData = validationResult.data
      }
      
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', explainabilityContent)
      // Fallback response
      explainabilityData = {
        explanation: `Risk score of ${risk_score}/10 for ${supplier} based on available data`,
        sources: [],
        recommendation: 'Please ensure all vendor data is complete for detailed analysis',
        factor_breakdown: []
      }
    }

    console.log('Explainability result:', explainabilityData)

    return new Response(
      JSON.stringify({ 
        success: true,
        supplier: supplier,
        risk_score: risk_score,
        explainability: explainabilityData
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Explainability engine error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Explainability failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
