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

    // Call Lovable AI to extract structured vendor offer data with multilingual support
    const extractionPrompt = `You are an intelligent document parser for ClarityChain AI.  
Your goal: extract all relevant procurement data and output it as structured JSON.

Step 1 — Auto-detect document language (e.g., English, Norwegian, Spanish, etc.).  
Step 2 — Translate key headers and values to English internally, but keep the original language text as a parallel field.  
Step 3 — Identify and structure the following entities:
- Supplier name
- Document type (quotation, offer, contract, BOM, etc.)
- Date and currency
- Line items (material, quantity, unit, price, delivery time, warranty)
- Terms (payment, penalties, validity, location, contact info)

Step 4 — Return clean JSON with schema:
{
  "language_detected": "string - detected language code",
  "supplier": "string - supplier/vendor company name",
  "document_type": "string - quotation, offer, contract, BOM, etc.",
  "date": "string - document date if found",
  "currency": "string - currency code (USD, EUR, NOK, etc.)",
  "items": [
    {
      "name": "string - material/item name",
      "name_original": "string - original language name",
      "part_number": "string - part/SKU number",
      "qty": number,
      "unit": "string - unit of measure",
      "price": number,
      "delivery": "string - delivery time/lead time",
      "warranty": "string - warranty terms"
    }
  ],
  "terms": {
    "payment": "string - payment terms",
    "penalties": "string - penalty clauses",
    "validity": "string - offer validity period",
    "location": "string - vendor location",
    "contact": "string - contact information"
  }
}

If any data is missing, write null.
Do not hallucinate or infer unspecified values.

Document content:
${documentText}

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
    const items = Array.isArray(extractedData.items) ? extractedData.items : []
    const totalPrice = items.reduce((sum: number, item: any) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0)
    
    const vendorData = {
      language_detected: extractedData.language_detected || 'unknown',
      vendor_name: extractedData.supplier || 'Unknown Vendor',
      document_type: extractedData.document_type || 'unknown',
      date: extractedData.date || null,
      quoted_price: totalPrice || 0,
      currency: extractedData.currency || 'USD',
      items_count: items.length,
      quoted_lead_time: items.length > 0 ? parseInt(items[0].delivery || '30') || 30 : 30,
      certifications: [],
      delivery_terms: extractedData.terms?.delivery || null,
      payment_terms: extractedData.terms?.payment || null,
      location: extractedData.terms?.location || 'Unknown',
      items: items.map((item: any) => ({
        part_number: item.part_number || null,
        description: item.name || item.name_original || 'Unknown Item',
        description_original: item.name_original || item.name || null,
        quantity: Number(item.qty) || 0,
        unit: item.unit || 'pcs',
        unit_price: Number(item.price) || 0,
        total_price: (Number(item.price) || 0) * (Number(item.qty) || 0),
        delivery_time: item.delivery || null,
        warranty: item.warranty || null
      })),
      terms: extractedData.terms || {},
      delivery_history: 'unknown',
      quoted_total: totalPrice || 0,
      line_item_total: totalPrice || 0
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
