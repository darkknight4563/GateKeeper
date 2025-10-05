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
  source: z.string().optional(), // Source location like "pdf#p2" or "xlsx#Sheet1!B5"
})

const TermsSchema = z.object({
  payment: z.string().nullable(),
  penalties: z.string().nullable(),
  validity: z.string().nullable(),
  location: z.string().nullable(),
  contact: z.string().nullable(),
  delivery_weeks: z.number().nullable(),
  warranty_months: z.number().nullable(),
  source: z.string().optional(),
}).nullable()

const TechnicalSpecsSchema = z.object({
  tubes: z.number().nullable(),
  fibers: z.number().nullable(),
  outer_diameter: z.string().nullable(),
  weight: z.string().nullable(),
  bend_radius: z.string().nullable(),
  length: z.string().nullable(),
  standards: z.array(z.string()).optional(),
  certifications: z.array(z.string()).optional(),
  source: z.string().optional(),
}).nullable()

const ExtractedDataSchema = z.object({
  language_detected: z.string(),
  supplier: z.string(),
  document_type: z.string().nullable(),
  date: z.string().nullable(),
  currency: z.string(),
  items: z.array(ItemSchema),
  terms: TermsSchema,
  technical_specs: TechnicalSpecsSchema.optional(),
  certifications: z.array(z.string()).optional(),
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
    const extractionPrompt = `You are an expert document parser for procurement documents with MANDATORY source citation.

CRITICAL EXTRACTION REQUIREMENTS:

1. **PRICING EXTRACTION** (Norwegian/English documents):
   - Extract from "Tilbutt enhetspris" (Offered unit price) or "Kostnad" (Cost) columns
   - Main product in "Hovedprodukt" section
   - Optional items in "Opsjon: vare/produkt/utstyr/kurs" section
   - Service levels in "Opsjon: servicenivå"
   - Sum all costs for total quoted price

2. **DELIVERY & WARRANTY** (REQUIRED for risk analysis):
   - Extract delivery time/lead time in WEEKS (convert months/days to weeks)
   - Extract warranty period in MONTHS (convert years/weeks to months)
   - Look for: "Leveringstid", "Lead time", "Delivery", "Garanti", "Warranty"
   - Source: Cite page/section where found

3. **CERTIFICATIONS** (REQUIRED for compliance):
   - Extract ALL certifications mentioned: ISO 9001, ISO 13485, DNV-GL, API 17E, DNV-ST-F119
   - Look in: Product descriptions, company info, compliance sections
   - Return as array: ["ISO 9001", "DNV-GL", "API 17E"]

4. **TECHNICAL SPECIFICATIONS** (REQUIRED for BOM):
   - tubes: Number of tubes/cores (look for "tubes", "rør", "cores")
   - fibers: Number of fibers per tube (look for "fibers", "fiber")
   - outer_diameter: Outside diameter with unit (e.g., "1/2 inch", "12.7mm")
   - weight: Weight with unit (e.g., "50 kg/km", "125 lb/ft")
   - bend_radius: Minimum bend radius with unit (e.g., "0.5m", "20 inches")
   - length: Cable/product length with unit (e.g., "5000m", "3.28 ft")
   - standards: Array of standards (e.g., ["DNV-ST-F119", "API 17E", "ISO 9001"])

5. **PAYMENT TERMS** (REQUIRED for contract analysis):
   - Extract payment terms: "Net 30", "50/50", "Payment on delivery"
   - Extract quote validity: Days valid (e.g., 30, 60, 90)

6. **SOURCE CITATIONS** (MANDATORY):
   - PDF: "pdf#p3" (page 3)
   - XLSX: "xlsx#Sheet1!B5" (Sheet1, cell B5)
   - DOCX: "docx#p2" (page 2)
   - Cite EVERY numeric value and critical field

JSON Schema (COMPLETE ALL FIELDS):
{
  "language_detected": "no" or "en",
  "supplier": "Philips" | "Siemens" | "GE" | "exact vendor name",
  "document_type": "offer" | "quote" | "RFQ",
  "date": "document date or null",
  "currency": "NOK" | "USD" | "EUR" (from header),
  "items": [
    {
      "name": "product name in English",
      "name_original": "original Norwegian/native name",
      "part_number": "article/part number",
      "qty": numeric quantity,
      "unit": "per stykk, per år, per time, etc.",
      "price": NUMERIC price from document,
      "delivery": "delivery time as string (e.g., '4-6 weeks')",
      "warranty": "warranty period as string (e.g., '24 months')",
      "source": "pdf#p2" or similar
    }
  ],
  "terms": {
    "payment": "payment terms text (e.g., 'Net 30 days')",
    "penalties": "late delivery penalties if any",
    "validity": "quote validity text (e.g., '60 days')",
    "location": "production country (USA, Kina, Danmark, Norge)",
    "contact": "contact info if available",
    "delivery_weeks": NUMERIC weeks (convert from months/days if needed),
    "warranty_months": NUMERIC months (convert from years/weeks if needed),
    "source": "pdf#p3" or location where terms found
  },
  "technical_specs": {
    "tubes": numeric count or null,
    "fibers": numeric count or null,
    "outer_diameter": "value with unit" or null,
    "weight": "value with unit" or null,
    "bend_radius": "value with unit" or null,
    "length": "value with unit" or null,
    "standards": ["DNV-ST-F119", "API 17E", ...] or [],
    "certifications": ["ISO 9001", "DNV-GL", ...] or [],
    "source": "pdf#p4" or where specs found
  },
  "certifications": ["ISO 9001", "ISO 13485", "DNV-GL", "API 17E"] or []
}

CONVERSION RULES:
- Delivery: "3 months" → 12-13 weeks, "45 days" → 6-7 weeks
- Warranty: "2 years" → 24 months, "52 weeks" → 12 months
- Always preserve original units in technical specs (don't convert 1/2" to mm)

EXAMPLES:
✅ CORRECT: "delivery_weeks": 8, "source": "pdf#p2"
✅ CORRECT: "warranty_months": 24, "source": "pdf#p3"
✅ CORRECT: "certifications": ["ISO 9001", "DNV-GL"]
✅ CORRECT: "outer_diameter": "1/2 inch", "source": "pdf#p5"
❌ WRONG: "delivery_weeks": null (extract it!)
❌ WRONG: No source citations

Document content:
${documentText}

Return ONLY valid JSON with ALL fields populated.`

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
          terms: parsedData.terms || {
            payment: null,
            penalties: null,
            validity: null,
            location: null,
            contact: null,
            delivery_weeks: null,
            warranty_months: null,
            source: null
          },
          technical_specs: parsedData.technical_specs || {
            tubes: null,
            fibers: null,
            outer_diameter: null,
            weight: null,
            bend_radius: null,
            length: null,
            standards: [],
            certifications: [],
            source: null
          },
          certifications: parsedData.certifications || [],
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
    
    // Extract technical specifications and certifications
    const technicalSpecs = extractedData.technical_specs || {}
    const certifications = extractedData.certifications || []
    const issues: string[] = []
    
    // Validate critical fields for pipeline
    if (!extractedData.terms?.delivery_weeks) {
      issues.push("Delivery time not specified")
    }
    if (!extractedData.terms?.warranty_months) {
      issues.push("Warranty information not specified")
    }
    if (!certifications || certifications.length === 0) {
      issues.push("ISO certification not mentioned")
    }
    if (!extractedData.terms?.payment) {
      issues.push("Payment terms not specified")
    }
    
    // Prepare vendor offer data with all required fields
    const vendorData = {
      language_detected: extractedData.language_detected,
      vendor_name: extractedData.supplier,
      document_type: extractedData.document_type,
      date: extractedData.date,
      quoted_price: totalPrice,
      currency: extractedData.currency,
      items_count: items.length,
      quoted_lead_time: extractedData.terms?.delivery_weeks || null,
      certifications: certifications,
      delivery_terms: extractedData.terms?.delivery_weeks ? `${extractedData.terms.delivery_weeks} weeks` : null,
      payment_terms: extractedData.terms?.payment,
      location: extractedData.terms?.location || "Unknown",
      items: items.map((item: any) => ({
        part_number: item.part_number,
        description: item.name,
        description_original: item.name_original,
        quantity: item.qty,
        unit: item.unit,
        unit_price: item.price,
        total_price: (item.price || 0) * (item.qty || 0),
        delivery_time: item.delivery,
        warranty: item.warranty,
        source: item.source
      })),
      terms: {
        payment: extractedData.terms?.payment,
        penalties: extractedData.terms?.penalties,
        validity: extractedData.terms?.validity,
        location: extractedData.terms?.location,
        contact: extractedData.terms?.contact,
        delivery_weeks: extractedData.terms?.delivery_weeks,
        warranty_months: extractedData.terms?.warranty_months,
        source: extractedData.terms?.source
      },
      delivery_history: "unknown",
      quoted_total: totalPrice,
      line_item_total: totalPrice,
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
