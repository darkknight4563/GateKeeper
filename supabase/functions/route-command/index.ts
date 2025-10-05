import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Schema for command routing response
const CommandRouteSchema = z.object({
  action: z.enum(['analyze', 'compare', 'export', 'upload', 'summarize', 'unknown']),
  detected_language: z.string(),
  user_message_language: z.string(),
  confidence: z.number().min(0).max(1).optional(),
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

    const { message } = await req.json()

    if (!message || typeof message !== 'string') {
      return new Response(
        JSON.stringify({ error: 'message (string) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Routing command for message:', message)

    // Create command routing prompt
    const routingPrompt = `You are a multilingual assistant for procurement analysis.  
Auto-detect the language of the user message and respond in the same language.  
If the message includes a command (e.g., "compare vendors" or "generate report"), translate it internally to English before execution, but identify the action to take.

Commands to recognize:
- "Upload and analyze" / "Sube y analiza" / "Last opp og analyser" → action: "analyze"
- "Compare offers" / "Compara ofertas" / "Sammenlign tilbud" → action: "compare"
- "Export report" / "Exporta informe" / "Eksporter rapport" → action: "export"
- "Upload" / "Subir" / "Last opp" → action: "upload"
- "Summarize" / "Resumir" / "Oppsummer" → action: "summarize"
- If no clear command is detected → action: "unknown"

User message: "${message}"

Return JSON with this exact structure:
{
  "action": "analyze|compare|export|upload|summarize|unknown",
  "detected_language": "language name (e.g., English, Spanish, Norwegian)",
  "user_message_language": "ISO 639-1 code (e.g., en, es, no)",
  "confidence": 0.0 to 1.0
}

Return ONLY valid JSON, no commentary.`

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
            content: 'You are a command routing assistant. Always return valid JSON only, no markdown formatting.' 
          },
          { role: 'user', content: routingPrompt }
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
      
      throw new Error(`AI command routing failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    const routingContent = aiResult.choices[0]?.message?.content

    if (!routingContent) {
      throw new Error('No routing result from AI response')
    }

    console.log('Raw AI routing response:', routingContent)

    // Parse and validate the JSON response
    let routingData
    try {
      const jsonMatch = routingContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : routingContent
      const parsedData = JSON.parse(jsonStr.trim())
      
      // Validate against schema
      const validationResult = CommandRouteSchema.safeParse(parsedData)
      
      if (!validationResult.success) {
        console.error('Schema validation failed:', validationResult.error.errors)
        // Return a default response
        routingData = {
          action: 'unknown',
          detected_language: 'unknown',
          user_message_language: 'unknown',
          confidence: 0.0
        }
      } else {
        routingData = validationResult.data
      }
      
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', routingContent)
      // Return a default response
      routingData = {
        action: 'unknown',
        detected_language: 'unknown',
        user_message_language: 'unknown',
        confidence: 0.0
      }
    }

    console.log('Command routing result:', routingData)

    return new Response(
      JSON.stringify({ 
        success: true,
        routing: routingData
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Command routing error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Command routing failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
