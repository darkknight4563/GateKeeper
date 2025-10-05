import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    const { extracted_data, language_detected } = await req.json()

    if (!extracted_data) {
      return new Response(
        JSON.stringify({ error: 'extracted_data required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Generating summary for extracted data')

    const detectedLanguage = language_detected || extracted_data.language_detected || 'English'
    
    // Create summary prompt
    const summaryPrompt = `Summarize this document in English in under 150 words.  
Include supplier name, total cost, main materials, and delivery time.  
If the document is not in English, translate the summary from the detected language (${detectedLanguage}) to English.  

Document data:
${JSON.stringify(extracted_data, null, 2)}

Output format:
{
  "original_summary": "summary in ${detectedLanguage}",
  "english_summary": "summary in English",
  "key_facts": {
    "supplier": "supplier name",
    "total_cost": "total cost with currency",
    "main_materials": ["list of main materials"],
    "delivery_time": "delivery time"
  }
}

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
            content: 'You are a document summarization assistant. Always return valid JSON only, no markdown formatting.' 
          },
          { role: 'user', content: summaryPrompt }
        ],
      }),
    })

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error('Lovable AI error:', aiResponse.status, errorText)
      throw new Error(`AI summarization failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    const summaryContent = aiResult.choices[0]?.message?.content

    if (!summaryContent) {
      throw new Error('No summary generated from AI response')
    }

    console.log('Raw AI summary response:', summaryContent)

    // Parse the JSON response
    let summaryData
    try {
      const jsonMatch = summaryContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : summaryContent
      summaryData = JSON.parse(jsonStr.trim())
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', summaryContent)
      throw new Error('Failed to parse summary data as JSON')
    }

    console.log('Generated summary:', summaryData)

    return new Response(
      JSON.stringify({ 
        success: true,
        summary: summaryData
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Summarize document error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Summarization failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
