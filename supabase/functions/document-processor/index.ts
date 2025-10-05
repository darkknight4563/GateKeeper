import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

// Schema validation for API response
const ItemSchema = z.object({
  name: z.string().nullable(),
  name_original: z.string().nullable(),
  part_number: z.string().nullable(),
  qty: z.number().nullable(),
  unit: z.string().nullable(),
  price: z.number().nullable(),
  delivery: z.string().nullable(),
  warranty: z.string().nullable(),
})

const TermsSchema = z.object({
  payment: z.string().nullable(),
  penalties: z.string().nullable(),
  validity: z.string().nullable(),
  location: z.string().nullable(),
  contact: z.string().nullable(),
}).nullable()

const ExtractedDataSchema = z.object({
  language_detected: z.string(),
  supplier: z.string(),
  document_type: z.string().nullable(),
  date: z.string().nullable(),
  currency: z.string(),
  items: z.array(ItemSchema),
  terms: TermsSchema,
})

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
    const extractionPrompt = `You are an expert document parser for Norwegian medical equipment procurement documents (Prisskjema).

CRITICAL INSTRUCTIONS:
1. This is a Norwegian pricing sheet for ultrasound equipment
2. Extract ALL pricing from the "Tilbutt enhetspris" (Offered unit price) or "Kostnad" (Cost) columns
3. The main product is in the "Hovedprodukt" section - extract its price
4. Optional items are in "Opsjon: vare/produkt/utstyr/kurs" section - extract all item prices
5. Service levels are in "Opsjon: servicenivå" - extract annual service costs
6. Currency is specified in the header row - look for "norwegian kroner" (NOK) or "USD dollars"
7. Sum up the main product cost + all optional item costs for the total quoted price

PRICING EXTRACTION RULES:
- Main product price is the first large price in Hovedprodukt section (e.g., 87000, 980000, 215000)
- Each optional item has its own price in the "Tilbutt enhetspris" column
- Ignore cells with "-" (means not applicable)
- Ignore cells with "0" in training sections (free training)
- For service levels, extract the per-year or per-hour prices

JSON Schema:
{
  "language_detected": "no" or "en",
  "supplier": "vendor name from document (Philips, Siemens, or GE)",
  "document_type": "offer",
  "date": "document date or null",
  "currency": "NOK" or "USD" (check header carefully),
  "items": [
    {
      "name": "product name in English",
      "name_original": "original Norwegian name",
      "part_number": "article number if available",
      "qty": quantity as number,
      "unit": "per stykk, per år, per time, etc.",
      "price": ACTUAL NUMERIC PRICE from Tilbutt enhetspris column,
      "delivery": "lead time if specified",
      "warranty": "warranty info if available"
    }
  ],
  "terms": {
    "payment": null,
    "penalties": null,
    "validity": null,
    "location": "production country (USA / Kina, Danmark, Norge, etc.)",
    "contact": null
  }
}

EXAMPLES OF CORRECT EXTRACTION:
- If you see "87,000" or "87000" in Tilbutt enhetspris for main product, extract price: 87000
- If currency header says "norwegian kroner", currency is "NOK"
- If currency header says "USD dollars", currency is "USD"
- Main product Philips ultra: price 87000, currency USD
- Main product Siemens Mediq: price 980000, currency NOK  
- Main product GE Venue: price 215000, currency NOK

Do NOT return 0 or null for prices that clearly exist in the document.
Extract every single line item with an actual price value.

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
    let validationNotes: string[] = []
    
    try {
      const jsonMatch = extractedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : extractedContent
      const parsedData = JSON.parse(jsonStr.trim())
      
      // Validate the parsed data against schema
      const validationResult = ExtractedDataSchema.safeParse(parsedData)
      
      if (!validationResult.success) {
        console.warn('Schema validation failed:', validationResult.error.errors)
        
        // Track missing/invalid fields
        validationResult.error.errors.forEach(err => {
          validationNotes.push(`Missing or invalid field: ${err.path.join('.')} - ${err.message}`)
        })
        
        // Fill missing required fields with defaults
        extractedData = {
          language_detected: parsedData.language_detected || 'unknown',
          supplier: parsedData.supplier || null,
          document_type: parsedData.document_type || null,
          date: parsedData.date || null,
          currency: parsedData.currency || 'USD',
          items: Array.isArray(parsedData.items) ? parsedData.items : [],
          terms: parsedData.terms || null,
        }
      } else {
        extractedData = validationResult.data
      }
      
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', extractedContent)
      throw new Error('Failed to parse extracted data as JSON')
    }

    // Validate and normalize the extracted data
    const items = Array.isArray(extractedData.items) ? extractedData.items : []
    const totalPrice = items.reduce((sum: number, item: any) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0)
    
    // Extract technical specifications from items
    const technicalSpecs: any = {}
    const issues: string[] = []
    
    // Look for technical spec items in the extracted data
    items.forEach((item: any) => {
      const name = (item.name || item.name_original || '').toLowerCase()
      if (name.includes('tube') || name.includes('rør')) {
        technicalSpecs.tubes = item.part_number || item.description
      }
      if (name.includes('fiber')) {
        technicalSpecs.fibers = item.part_number || item.description
      }
      if (name.includes('diameter')) {
        technicalSpecs.outerDiameter = item.description
      }
      if (name.includes('weight') || name.includes('vekt')) {
        technicalSpecs.weight = item.description
      }
      if (name.includes('bend') || name.includes('bøy')) {
        technicalSpecs.bendRadius = item.description
      }
      if (name.includes('length') || name.includes('lengde')) {
        technicalSpecs.length = item.description
      }
      if (name.includes('spec') || name.includes('standard')) {
        technicalSpecs.specification = item.description
      }
    })
    
    // Check for missing certifications
    if (!extractedData.terms?.warranty && !items.some((i: any) => i.warranty)) {
      issues.push('Warranty information not specified')
    }
    
    // Check for missing ISO certification
    const hasCertification = items.some((i: any) => 
      (i.name || i.name_original || '').toLowerCase().includes('iso')
    )
    if (!hasCertification) {
      issues.push('ISO certification not mentioned')
    }
    
    // Check for unclear delivery terms
    if (!extractedData.terms?.delivery && !items.some((i: any) => i.delivery)) {
      issues.push('Delivery terms unclear')
    }
    
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
      line_item_total: totalPrice || 0,
      technical_specs: technicalSpecs,
      issues: issues
    }

    console.log('Processed vendor data:', vendorData)

    return new Response(
      JSON.stringify({ 
        success: true,
        vendor_data: vendorData,
        raw_extraction: extractedData,
        validation_notes: validationNotes.length > 0 ? validationNotes : undefined
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
