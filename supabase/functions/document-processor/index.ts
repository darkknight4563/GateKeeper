import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'
import * as XLSX from 'https://esm.sh/xlsx@0.18.5'

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

    const { document_id, file_content, filename, mime_type, fragments } = await req.json()

    if (!document_id) {
      return new Response(
        JSON.stringify({ error: 'document_id required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Support both old API (file_content) and new API (fragments)
    let parsedFragments: any[];
    
    if (fragments) {
      // New API: fragments already parsed
      console.log(`Received ${fragments.length} pre-parsed fragments for document ${document_id}`)
      parsedFragments = fragments;
    } else if (file_content) {
      // Old API: Guard and parse file_content
      if (file_content.length < 1000) {
        console.error('Empty or too small file content received:', file_content.length, 'bytes')
        return new Response(
          JSON.stringify({ 
            error: `Empty file content received (${file_content.length} bytes). File may not have uploaded correctly.` 
          }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log(`Processing document ${document_id}, type: ${mime_type}, content size: ${file_content.length} bytes`)

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

      // Parse file based on MIME type and create structured fragments
      const tempFragments: any[] = []
      const mimeType = mime_type || document.mime_type
      const supplierHint = filename ? filename.split(/[_\-\.]/)[0] : null
      
      try {
        if (mimeType === 'application/pdf') {
          console.log('Parsing PDF - extracting text fragments')
          try {
            const textData = atob(file_content)
            const matches = textData.match(/[\x20-\x7E]+/g) || []
            const pageText = matches.filter(s => s.length > 3).join('\n')
            
            // Split into logical fragments (pages or sections)
            const lines = pageText.split('\n').filter(l => l.trim())
            let currentFragment = ''
            let pageNum = 1
            
            lines.forEach((line, idx) => {
              currentFragment += line + '\n'
              // Create fragment every ~30 lines or at natural breaks
              if ((idx + 1) % 30 === 0 || idx === lines.length - 1) {
                if (currentFragment.trim()) {
                  tempFragments.push({
                    source: `${filename}#p${pageNum}`,
                    text: currentFragment.trim()
                  })
                  currentFragment = ''
                  pageNum++
                }
              }
            })
            
            console.log(`Extracted ${tempFragments.length} PDF fragments`)
          } catch (e) {
            console.warn('PDF parsing fallback:', e)
            tempFragments.push({
              source: `${filename}#filename`,
              text: `Filename: ${filename}`
            })
          }
          
        } else if (mimeType === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' || 
                   mimeType === 'application/vnd.ms-excel') {
          console.log('Parsing Excel - extracting table fragments')
          const binaryData = Uint8Array.from(atob(file_content), c => c.charCodeAt(0))
          const workbook = XLSX.read(binaryData, { type: 'array' })
          
          workbook.SheetNames.forEach((sheetName: string) => {
            const sheet = workbook.Sheets[sheetName]
            const jsonData: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as any[][]
            
            if (jsonData.length > 0) {
              // Find header row (first non-empty row)
              const headerRowIdx = jsonData.findIndex(row => row && row.some(cell => cell))
              if (headerRowIdx >= 0) {
                const headers = jsonData[headerRowIdx]
                const dataRows = jsonData.slice(headerRowIdx + 1).filter(row => row && row.some(cell => cell))
                
                // Create table fragment
                tempFragments.push({
                  source: `${filename}#${sheetName}!A${headerRowIdx + 1}:${String.fromCharCode(65 + headers.length - 1)}${headerRowIdx + 1 + dataRows.length}`,
                  table: [headers, ...dataRows]
                })
              }
            }
          })
          
          console.log(`Extracted ${tempFragments.length} Excel table fragments`)
          
        } else if (mimeType === 'text/csv') {
          console.log('Parsing CSV - extracting table fragment')
          const csvText = atob(file_content)
          const lines = csvText.split('\n').filter(l => l.trim())
          
          if (lines.length > 0) {
            const table = lines.map(line => line.split(',').map(cell => cell.trim()))
            tempFragments.push({
              source: `${filename}#rows1-${lines.length}`,
              table
            })
          }
          
          console.log(`Extracted CSV with ${lines.length} rows`)
          
        } else {
          console.warn(`Unsupported MIME type: ${mimeType}`)
          try {
            const text = atob(file_content)
            tempFragments.push({
              source: `${filename}#full`,
              text: text.substring(0, 2000) // Limit to 2000 chars
            })
          } catch (e) {
            tempFragments.push({
              source: `${filename}#filename`,
              text: `Filename: ${filename}, Type: ${mimeType}`
            })
          }
        }
      } catch (parseError) {
        console.error('File parsing error:', parseError)
        tempFragments.push({
          source: `${filename}#error`,
          text: `Error parsing file. Filename: ${filename}, Type: ${mimeType}`
        })
      }
      
      if (tempFragments.length === 0) {
        console.warn('No fragments extracted, using filename')
        tempFragments.push({
          source: `${filename || document.filename}#filename`,
          text: `Filename: ${filename || document.filename}`
        })
      }

      parsedFragments = tempFragments;
    } else {
      return new Response(
        JSON.stringify({ error: 'Either fragments or file_content must be provided' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Now parsedFragments contains the fragments to process
    
    console.log(`Total parsed fragments: ${parsedFragments.length}`)
    
    // Assemble structured payload
    const payload = {
      doc_meta: {
        supplier_hint: filename ? filename.split(/[_\-\.]/)[0] : null,
        mime: mime_type,
        filename: filename
      },
      fragments: parsedFragments
    }

    // Call Lovable AI with structured fragments and strict extraction rules
    const extractionPrompt = `You are an expert procurement document parser. Extract ONLY data present in the provided fragments.

CRITICAL RULES:
1. **NO HALLUCINATION**: Only extract fields that are explicitly present in fragments
2. **MANDATORY SOURCE**: Every numeric value MUST include its source pointer
3. **DATA GAPS**: If a field is missing, set to null and add a note in validation_notes
4. **SUPPLIER HINT**: Use doc_meta.supplier_hint as a starting point for vendor name

STRUCTURED PAYLOAD:
${JSON.stringify(payload, null, 2)}

EXTRACTION SCHEMA:
{
  "language_detected": "no" | "en" | "unknown",
  "supplier": "exact vendor name from fragments or supplier_hint",
  "document_type": "offer" | "quote" | "RFQ" | null,
  "date": "YYYY-MM-DD or null",
  "currency": "NOK" | "USD" | "EUR" | null,
  "items": [
    {
      "name": "product name in English",
      "name_original": "original language name",
      "part_number": "part/article number or null",
      "qty": numeric or null,
      "unit": "stk | år | time | m | etc. or null",
      "price": numeric or null,
      "delivery": "delivery time string or null",
      "warranty": "warranty period string or null",
      "source": "fragment source pointer (REQUIRED for price, delivery, warranty)"
    }
  ],
  "terms": {
    "payment": "payment terms or null",
    "penalties": "penalties or null",
    "validity": "quote validity or null",
    "location": "production country or null",
    "contact": "contact info or null",
    "delivery_weeks": numeric weeks or null,
    "warranty_months": numeric months or null,
    "source": "fragment source or null"
  },
  "technical_specs": {
    "tubes": numeric or null,
    "fibers": numeric or null,
    "outer_diameter": "value with unit or null",
    "weight": "value with unit or null",
    "bend_radius": "value with unit or null",
    "length": "value with unit or null",
    "standards": ["standard1", ...] or [],
    "certifications": ["cert1", ...] or [],
    "source": "fragment source or null"
  },
  "certifications": ["ISO 9001", ...] or [],
  "validation_notes": [
    "[Data Gap] Delivery time not found in fragments",
    "[Data Gap] Warranty not specified",
    ...
  ]
}

CONVERSION RULES (only if data is present):
- Delivery: "3 months" → 12-13 weeks, "45 days" → 6-7 weeks
- Warranty: "2 years" → 24 months, "52 weeks" → 12 months

EXAMPLES OF CORRECT EXTRACTION:
✅ "price": 15000, "source": "Philips.xlsx#Sheet1!D5"
✅ "delivery_weeks": 34, "source": "offer.pdf#p2"
✅ "validation_notes": ["[Data Gap] Certifications not mentioned"]
✅ "warranty_months": null (when not found in fragments)

❌ WRONG: Making up delivery times not in fragments
❌ WRONG: Assuming certifications without evidence
❌ WRONG: Missing source pointers on numeric values

Return ONLY valid JSON matching the schema.`

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
