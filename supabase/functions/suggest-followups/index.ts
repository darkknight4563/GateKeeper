import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const RecommendationSchema = z.object({
  type: z.enum(['Action', 'Insight', 'Data Gap']),
  description: z.string(),
  priority: z.enum(['high', 'medium', 'low']).optional(),
})

const FollowUpResponseSchema = z.object({
  recommendations: z.array(RecommendationSchema).min(1).max(3),
  summary: z.string().optional(),
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

    const { conversation_history, report_data, job_id } = await req.json()

    console.log('Generating follow-up recommendations')
    console.log('Conversation messages:', conversation_history?.length || 0)
    console.log('Job ID:', job_id)

    // Retrieve latest report data from database if not provided
    let reportContext = report_data || {}
    
    if (!report_data || Object.keys(report_data).length === 0) {
      console.log('Fetching report data from database')
      
      // Get user's latest documents and analysis
      const { data: documents } = await supabase
        .from('documents')
        .select('*')
        .eq('user_id', user.id)
        .order('created_at', { ascending: false })
        .limit(5)

      if (documents && documents.length > 0) {
        const documentIds = documents.map(d => d.id)
        
        // Get vendor offers
        const { data: offers } = await supabase
          .from('vendor_offers')
          .select('*')
          .in('document_id', documentIds)
        
        reportContext.vendors = offers || []
        
        if (offers && offers.length > 0) {
          const offerIds = offers.map(o => o.id)
          
          // Get risk assessments
          const { data: risks } = await supabase
            .from('risk_assessments')
            .select('*')
            .in('vendor_offer_id', offerIds)
          
          reportContext.risk_assessments = risks || []
          
          // Get TCO data
          const { data: tcos } = await supabase
            .from('tco_calculations')
            .select('*')
            .in('vendor_offer_id', offerIds)
          
          reportContext.tco_calculations = tcos || []
          
          // Get lead time data
          const { data: leadTimes } = await supabase
            .from('lead_time_analysis')
            .select('*')
            .in('vendor_offer_id', offerIds)
          
          reportContext.lead_time_analyses = leadTimes || []
        }
      }
    }

    console.log('Report context:', {
      vendors: reportContext.vendors?.length || 0,
      risks: reportContext.risk_assessments?.length || 0,
      tcos: reportContext.tco_calculations?.length || 0
    })

    // Build follow-up recommendation prompt
    const recommendationPrompt = `Based on the conversation and report data, suggest 1–3 next steps for the procurement team.

Classify each as:
- [Action] (immediate next move)
- [Insight] (something to highlight in report)
- [Data Gap] (missing info to follow up)

Conversation History:
${conversation_history ? JSON.stringify(conversation_history, null, 2) : 'No conversation history provided'}

Report Data:
${JSON.stringify(reportContext, null, 2)}

Instructions:
1. Analyze the report data and conversation to identify critical next steps
2. Prioritize recommendations based on impact and urgency
3. Be specific and actionable
4. Focus on procurement-relevant recommendations

Return ONLY this JSON structure:
{
  "recommendations": [
    {
      "type": "Action|Insight|Data Gap",
      "description": "Specific recommendation text",
      "priority": "high|medium|low"
    }
  ],
  "summary": "Brief overview of why these recommendations matter"
}

Examples:
- [Action] Contact Aker to confirm updated delivery schedule.
- [Insight] TechnipFMC's lower warranty may offset short-term savings.
- [Data Gap] Missing supplier ESG documentation for OneSubsea.

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
            content: 'You are a procurement recommendation assistant. Always return valid JSON only, no markdown formatting.' 
          },
          { role: 'user', content: recommendationPrompt }
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
      
      throw new Error(`AI recommendation failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    const recommendationContent = aiResult.choices[0]?.message?.content

    if (!recommendationContent) {
      throw new Error('No recommendations generated from AI response')
    }

    console.log('Raw AI recommendation response:', recommendationContent)

    // Parse and validate the JSON response
    let followUpData
    try {
      const jsonMatch = recommendationContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : recommendationContent
      const parsedData = JSON.parse(jsonStr.trim())
      
      // Validate against schema
      const validationResult = FollowUpResponseSchema.safeParse(parsedData)
      
      if (!validationResult.success) {
        console.warn('Schema validation failed:', validationResult.error.errors)
        // Provide defaults if validation fails
        followUpData = {
          recommendations: Array.isArray(parsedData.recommendations) 
            ? parsedData.recommendations.slice(0, 3)
            : [
                {
                  type: 'Action',
                  description: 'Review vendor comparison report',
                  priority: 'medium'
                }
              ],
          summary: parsedData.summary || 'Review the analysis and take appropriate action'
        }
      } else {
        followUpData = validationResult.data
      }
      
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', recommendationContent)
      // Fallback response
      followUpData = {
        recommendations: [
          {
            type: 'Action',
            description: 'Review the vendor comparison report and identify key decision factors',
            priority: 'high'
          }
        ],
        summary: 'Please ensure all vendor data is complete for detailed recommendations'
      }
    }

    console.log('Follow-up recommendations:', followUpData)

    return new Response(
      JSON.stringify({ 
        success: true,
        follow_ups: followUpData,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Follow-up recommendation error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Follow-up recommendation failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
