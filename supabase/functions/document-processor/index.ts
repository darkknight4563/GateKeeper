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

    const { document_id, file_content } = await req.json()

    if (!document_id) {
      return new Response(
        JSON.stringify({ error: 'document_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log(`Processing document ${document_id}`)

    // Get document metadata
    const { data: document, error: docError } = await supabase
      .from('documents')
      .select('*')
      .eq('id', document_id)
      .eq('user_id', user.id)
      .single()

    if (docError || !document) {
      return new Response(
        JSON.stringify({ error: 'Document not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Extract text content based on file type
    let documentText = ''
    
    if (file_content) {
      documentText = file_content
    } else {
      documentText = `Document content for ${document.filename}`
    }

    // Call Lovable AI to extract structured vendor offer data
    const extractionPrompt = `You are a procurement data extraction expert. Analyze this vendor offer document and extract the following information in JSON format:

{
  "vendor_name": "string - the supplier/vendor company name",
  "quoted_price": number - total quoted price/amount,
  "currency": "string - currency code (USD, EUR, etc.)",
  "items": [
    {
      "part_number": "string",
      "description": "string", 
      "quantity": number,
      "unit_price": number,
      "total_price": number
    }
  ],
  "quoted_lead_time": number - delivery lead time in days,
  "certifications": ["string array - any mentioned certifications like ISO 9001, AS9100"],
  "delivery_terms": "string - delivery terms if mentioned",
  "payment_terms": "string - payment terms if mentioned",
  "location": "string - vendor location/country"
}

Document content:
${documentText}

Extract all available information. If a field is not found, use reasonable defaults or null. Return ONLY valid JSON.`

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
            content: 'You are a data extraction assistant. Always return valid JSON only, no markdown formatting.' 
          },
          { role: 'user', content: extractionPrompt }
        ],
        temperature: 0.1,
      }),
    })

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error('Lovable AI error:', aiResponse.status, errorText)
      throw new Error(`AI extraction failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    const extractedContent = aiResult.choices[0]?.message?.content

    if (!extractedContent) {
      throw new Error('No content extracted from AI response')
    }

    console.log('Raw AI response:', extractedContent)

    // Parse the JSON response (handle potential markdown code blocks)
    let extractedData
    try {
      const jsonMatch = extractedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : extractedContent
      extractedData = JSON.parse(jsonStr.trim())
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', extractedContent)
      throw new Error('Failed to parse extracted data as JSON')
    }

    // Validate and normalize the extracted data
    const vendorData = {
      vendor_name: extractedData.vendor_name || 'Unknown Vendor',
      quoted_price: Number(extractedData.quoted_price) || 0,
      currency: extractedData.currency || 'USD',
      items_count: Array.isArray(extractedData.items) ? extractedData.items.length : 0,
      quoted_lead_time: Number(extractedData.quoted_lead_time) || 30,
      certifications: Array.isArray(extractedData.certifications) ? extractedData.certifications : [],
      delivery_terms: extractedData.delivery_terms || null,
      payment_terms: extractedData.payment_terms || null,
      location: extractedData.location || 'Unknown',
      items: extractedData.items || [],
      delivery_history: 'unknown',
      quoted_total: Number(extractedData.quoted_price) || 0,
      line_item_total: Array.isArray(extractedData.items) 
        ? extractedData.items.reduce((sum: number, item: any) => sum + (Number(item.total_price) || 0), 0)
        : 0
    }

    console.log('Processed vendor data:', vendorData)

    return new Response(
      JSON.stringify({ 
        success: true,
        vendor_data: vendorData,
        raw_extraction: extractedData
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Document processor error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Processing failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
