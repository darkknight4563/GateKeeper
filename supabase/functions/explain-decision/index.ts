import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const DecisionRequestSchema = z.object({
  workflow_id: z.string().uuid(),
  actor_name: z.string(),
  decision_type: z.enum(['approve', 'reject', 'revise', 'comment']),
  human_comment: z.string().optional(),
  system_recommendation: z.object({
    recommended_action: z.string(),
    confidence: z.number().min(0).max(100),
    reasoning: z.string(),
  }).optional(),
})

interface ExplainabilityOutput {
  alignment: 'aligned' | 'contradictory' | 'neutral'
  summary: string
  source_reference: string[]
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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

    const requestBody = await req.json()
    const validation = DecisionRequestSchema.safeParse(requestBody)
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: validation.error.errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { workflow_id, actor_name, decision_type, human_comment, system_recommendation } = validation.data

    console.log('Explaining decision for workflow:', workflow_id)

    // Gather workflow and AI analysis data
    const { data: workflow } = await supabase
      .from('approval_workflows')
      .select('supplier_name, current_state, document_id, vendor_offer_id')
      .eq('id', workflow_id)
      .single()

    if (!workflow) {
      return new Response(
        JSON.stringify({ error: 'Workflow not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get AI analysis data (risk, TCO, lead time)
    let aiAnalysis = ''
    const sourceReferences: string[] = []

    if (workflow.vendor_offer_id) {
      const { data: riskData } = await supabase
        .from('risk_assessments')
        .select('risk_score, risk_factors')
        .eq('vendor_offer_id', workflow.vendor_offer_id)
        .single()

      if (riskData) {
        aiAnalysis += `AI Risk Assessment: ${riskData.risk_score}/100\n`
        aiAnalysis += `Risk Factors: ${JSON.stringify(riskData.risk_factors)}\n`
        sourceReferences.push('AI_report#risk_section')
      }

      const { data: tcoData } = await supabase
        .from('tco_calculations')
        .select('calculated_tco, breakdown')
        .eq('vendor_offer_id', workflow.vendor_offer_id)
        .single()

      if (tcoData) {
        aiAnalysis += `AI TCO Calculation: ${tcoData.calculated_tco}\n`
        sourceReferences.push('AI_report#tco_section')
      }

      const { data: leadData } = await supabase
        .from('lead_time_analysis')
        .select('estimated_lead_time, confidence_level')
        .eq('vendor_offer_id', workflow.vendor_offer_id)
        .single()

      if (leadData) {
        aiAnalysis += `AI Lead Time: ${leadData.estimated_lead_time} days (${leadData.confidence_level}% confidence)\n`
        sourceReferences.push('AI_report#lead_time_section')
      }
    }

    // Add human comment to sources if provided
    if (human_comment) {
      sourceReferences.push('actor_comment')
    }

    // Build context for AI
    const decisionContext = `
Supplier: ${workflow.supplier_name}
Actor: ${actor_name}
Decision: ${decision_type.toUpperCase()}
Human Comment: ${human_comment || 'No comment provided'}

AI Analysis:
${aiAnalysis || 'No AI analysis available'}

System Recommendation:
${system_recommendation ? `
- Recommended Action: ${system_recommendation.recommended_action}
- Confidence: ${system_recommendation.confidence}%
- Reasoning: ${system_recommendation.reasoning}
` : 'No system recommendation available'}
`

    console.log('Decision context prepared:', decisionContext.substring(0, 500) + '...')

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
          {
            role: 'system',
            content: `You are the Audit Narrator for ClarityChain AI, a procurement analysis platform.

Your task is to analyze approval/rejection decisions and create audit-ready explanations.

For each decision, you must:
1. Create a one-sentence rationale linking the human choice to available AI data
2. Determine if the decision aligns or contradicts AI recommendations
3. Provide a clear summary for audit logs

Alignment rules:
- "aligned": Human decision matches AI recommendation and risk assessment
- "contradictory": Human decision goes against AI recommendation or ignores high-risk factors
- "neutral": No clear AI recommendation, or decision is based on factors AI didn't analyze

Be objective and factual. Focus on data correlation, not judgment.`
          },
          {
            role: 'user',
            content: `Analyze this procurement decision and explain the rationale:\n\n${decisionContext}`
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'explain_decision',
              description: 'Generate audit explanation for a procurement decision',
              parameters: {
                type: 'object',
                properties: {
                  alignment: {
                    type: 'string',
                    enum: ['aligned', 'contradictory', 'neutral'],
                    description: 'Whether the decision aligns with AI recommendations'
                  },
                  summary: {
                    type: 'string',
                    description: 'One-sentence rationale linking human choice to AI data'
                  }
                },
                required: ['alignment', 'summary'],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: 'function', function: { name: 'explain_decision' } }
      }),
    })

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error('AI API error:', aiResponse.status, errorText)
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      return new Response(
        JSON.stringify({ error: 'AI API error', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiData = await aiResponse.json()
    console.log('AI response received:', JSON.stringify(aiData))

    // Extract explanation from tool call
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0]
    if (!toolCall || toolCall.function.name !== 'explain_decision') {
      return new Response(
        JSON.stringify({ error: 'Failed to generate decision explanation' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const explanation: ExplainabilityOutput = JSON.parse(toolCall.function.arguments)
    explanation.source_reference = sourceReferences

    console.log('Generated explanation:', explanation)

    // Store explanation in audit log metadata (optional enhancement)
    const { error: updateError } = await supabase
      .from('approval_audit_logs')
      .update({
        metadata: {
          explainability: explanation,
          generated_at: new Date().toISOString(),
        }
      })
      .eq('workflow_id', workflow_id)
      .eq('actor_name', actor_name)
      .order('created_at', { ascending: false })
      .limit(1)

    if (updateError) {
      console.warn('Failed to update audit log with explanation:', updateError)
    }

    return new Response(
      JSON.stringify({
        success: true,
        explanation,
        workflow: {
          id: workflow_id,
          supplier_name: workflow.supplier_name,
          decision_type,
          actor_name,
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error explaining decision:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to explain decision',
        details: error instanceof Error ? error.stack : undefined
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
