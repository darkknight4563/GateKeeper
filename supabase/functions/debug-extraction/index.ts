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

    const { document_content } = await req.json()

    if (!document_content) {
      return new Response(
        JSON.stringify({ error: 'document_content required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('=== DEBUG MODE: Starting document extraction ===')
    console.log('Document content length:', document_content.length)

    const debugPrompt = `You are in developer mode.  
Display detected language, parsed entities, and API payload.  
Do not summarize. Do not polish language.  
Show raw parsed fields with confidence scores if available.

Analyze this document and extract ALL raw data:

Document content:
${document_content}

Return JSON with this structure:
{
  "debug_info": {
    "timestamp": "ISO timestamp",
    "document_length": number,
    "processing_time_ms": number
  },
  "language_detection": {
    "detected_language": "language name",
    "language_code": "ISO code",
    "confidence": 0.0 to 1.0
  },
  "parsed_entities": {
    "supplier": {
      "value": "raw extracted value",
      "confidence": 0.0 to 1.0,
      "source_location": "where in document"
    },
    "document_type": {
      "value": "raw extracted value",
      "confidence": 0.0 to 1.0
    },
    "date": {
      "value": "raw extracted value",
      "confidence": 0.0 to 1.0
    },
    "currency": {
      "value": "raw extracted value",
      "confidence": 0.0 to 1.0
    },
    "total_amount": {
      "value": number,
      "confidence": 0.0 to 1.0
    }
  },
  "line_items": [
    {
      "raw_text": "exact text from document",
      "parsed": {
        "name": "value",
        "name_original": "value",
        "part_number": "value",
        "qty": number,
        "unit": "value",
        "price": number,
        "delivery": "value",
        "warranty": "value"
      },
      "confidence": 0.0 to 1.0,
      "extraction_notes": "any parsing issues or ambiguities"
    }
  ],
  "terms": {
    "payment": {
      "value": "raw text",
      "confidence": 0.0 to 1.0
    },
    "delivery": {
      "value": "raw text",
      "confidence": 0.0 to 1.0
    },
    "warranty": {
      "value": "raw text",
      "confidence": 0.0 to 1.0
    },
    "penalties": {
      "value": "raw text",
      "confidence": 0.0 to 1.0
    }
  },
  "api_payload": {
    "ready_for_submission": true/false,
    "validation_errors": ["list of issues"],
    "payload": "the exact JSON that would be sent to API"
  },
  "raw_extraction_notes": "any issues, ambiguities, or missing data"
}

Return ONLY valid JSON with ALL fields populated. Use null for missing data.`

    const startTime = Date.now()

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
            content: 'You are a debug assistant. Return detailed raw extraction data with confidence scores. Always return valid JSON only, no markdown formatting.' 
          },
          { role: 'user', content: debugPrompt }
        ],
      }),
    })

    const processingTime = Date.now() - startTime

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error('=== DEBUG: Lovable AI error ===')
      console.error('Status:', aiResponse.status)
      console.error('Response:', errorText)
      
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
      
      throw new Error(`AI debug extraction failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    const debugContent = aiResult.choices[0]?.message?.content

    if (!debugContent) {
      throw new Error('No debug data from AI response')
    }

    console.log('=== DEBUG: Raw AI response ===')
    console.log(debugContent)

    // Parse the JSON response
    let debugData
    try {
      const jsonMatch = debugContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : debugContent
      debugData = JSON.parse(jsonStr.trim())
      
      // Add actual processing time
      if (debugData.debug_info) {
        debugData.debug_info.actual_processing_time_ms = processingTime
      }
      
    } catch (parseError) {
      console.error('=== DEBUG: JSON parse error ===')
      console.error('Error:', parseError)
      console.error('Content:', debugContent)
      
      // Return raw content if parsing fails
      debugData = {
        error: 'Failed to parse debug data',
        raw_content: debugContent,
        parse_error: parseError instanceof Error ? parseError.message : 'Unknown error'
      }
    }

    console.log('=== DEBUG: Final parsed data ===')
    console.log(JSON.stringify(debugData, null, 2))

    return new Response(
      JSON.stringify({ 
        success: true,
        debug_mode: true,
        processing_time_ms: processingTime,
        debug_data: debugData,
        raw_ai_response: debugContent,
        request_metadata: {
          user_id: user.id,
          timestamp: new Date().toISOString(),
          document_content_length: document_content.length
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('=== DEBUG: Extraction error ===')
    console.error('Error:', error)
    console.error('Stack:', error instanceof Error ? error.stack : 'No stack trace')
    
    return new Response(
      JSON.stringify({ 
        success: false,
        error: error instanceof Error ? error.message : 'Debug extraction failed',
        details: error instanceof Error ? error.stack : undefined,
        debug_mode: true
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
