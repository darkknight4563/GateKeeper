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
  'Access-Control-Allow-Origin': Deno.env.get('ALLOWED_ORIGIN') ?? '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

serve(async (req) => {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { status: 200, headers: corsHeaders });
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

    console.log('=== DOCUMENT-PROCESSOR START ===')
    console.log('document_id:', document_id)
    console.log('has fragments:', !!fragments)
    console.log('has file_content:', !!file_content)
    console.log('filename:', filename)
    console.log('mime_type:', mime_type)

    if (!document_id) {
      console.error('ERROR: document_id missing')
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
    
    console.log('=== FRAGMENTS READY ===')
    console.log(`Total parsed fragments: ${parsedFragments.length}`)
    console.log('Fragment sources:', parsedFragments.map(f => f.source))
    
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
    const extractionPrompt = `You are ClarityChain's procurement document extractor. Extract data using ONLY the provided fragments below.

CRITICAL RULES:
1. **NO HALLUCINATION**: Extract ONLY values explicitly present in fragments
2. **MANDATORY SOURCE TRACKING**: Every numeric field (delivery_weeks, warranty_months, unit_price, subtotal, quoted_price) MUST include a "source" field copied from the corresponding fragment.source
3. **DATA GAPS**: If you cannot find a value in any fragment, set it to null and add a note: "[Data Gap] field-name not found in fragments"
4. **DO NOT INFER**: Do not calculate, estimate, or fabricate any values

STRUCTURED PAYLOAD:
${JSON.stringify(payload, null, 2)}

REQUIRED OUTPUT SCHEMA:
{
  "documents": [
    {
      "supplier": "<string|null>",
      "currency": "<string|null>",
      "terms": {
        "delivery_weeks": <number|null>,
        "warranty_months": <number|null>,
        "payment_terms": "<string|null>",
        "source_terms": "<source from fragment or null>"
      },
      "line_items": [
        {
          "name": "<string>",
          "qty": <number|null>,
          "unit": "<string|null>",
          "unit_price": <number|null>,
          "subtotal": <number|null>,
          "source": "<source from fragment - REQUIRED for unit_price/subtotal>"
        }
      ],
      "totals": {
        "quoted_price": <number|null>,
        "source": "<source from fragment - REQUIRED if quoted_price is not null>"
      }
    }
  ],
  "notes": [
    "[Data Gap] delivery_weeks not found in fragments",
    "[Data Gap] warranty_months not mentioned"
  ]
}

CONVERSION RULES (only apply if data is explicitly present):
- Delivery: "3 months" → 12-13 weeks, "45 days" → ~6 weeks
- Warranty: "2 years" → 24 months, "52 weeks" → 12 months

EXAMPLES:
✅ CORRECT: "unit_price": 1500, "source": "offer.pdf#p2"
✅ CORRECT: "delivery_weeks": 34, "source_terms": "Philips.xlsx#Sheet1!B5"
✅ CORRECT: "warranty_months": null (when not in fragments, add note)

❌ WRONG: "delivery_weeks": 8 (when not in fragments - this is hallucination)
❌ WRONG: "unit_price": 1500 (missing "source" field)
❌ WRONG: Making assumptions about values not in fragments

Return ONLY valid JSON matching the schema above. No markdown, no explanations.`

    console.log('=== CALLING AI ===')
    console.log('Model: google/gemini-2.5-flash')
    console.log('Prompt length:', extractionPrompt.length)
    
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

    console.log('=== AI RESPONSE ===')
    console.log('Status:', aiResponse.status)
    console.log('OK:', aiResponse.ok)

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error('Lovable AI error:', aiResponse.status, errorText)
      throw new Error(`AI extraction failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    console.log('=== AI RESULT PARSED ===')
    console.log('Has choices:', !!aiResult.choices)
    console.log('Choices length:', aiResult.choices?.length)
    
    const extractedContent = aiResult.choices[0]?.message?.content

    if (!extractedContent) {
      console.error('ERROR: No content extracted from AI response')
      console.error('AI result:', JSON.stringify(aiResult))
      throw new Error('No content extracted from AI response')
    }

    console.log('=== EXTRACTED CONTENT ===')
    console.log('Content length:', extractedContent.length)
    console.log('Raw AI response preview:', extractedContent.substring(0, 200))

    // Parse the JSON response (handle potential markdown code blocks)
    let parsedResponse
    
    try {
      const jsonMatch = extractedContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : extractedContent
      parsedResponse = JSON.parse(jsonStr.trim())
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', extractedContent)
      throw new Error('Failed to parse extracted data as JSON')
    }

    // Validate extracted data for critical fields
    const documents = parsedResponse.documents || []
    const notes = parsedResponse.notes || []
    
    if (documents.length === 0) {
      console.error('DIAGNOSTIC: No documents extracted from fragments')
      return new Response(
        JSON.stringify({
          error: 'DIAGNOSTIC: Extraction returned no documents',
          fragments_searched: parsedFragments.map(f => ({ source: f.source, preview: (f.text || '').substring(0, 100) })),
          notes: notes
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Check if ALL critical fields are missing (fail-fast validation)
    const allDocsMissingCriticalData = documents.every((doc: any) => 
      (!doc.terms?.delivery_weeks && !doc.terms?.warranty_months) &&
      (!doc.line_items || doc.line_items.length === 0)
    )

    if (allDocsMissingCriticalData) {
      console.error('DIAGNOSTIC: All documents missing critical fields (delivery_weeks, warranty_months, line_items)')
      
      const missingFields: string[] = []
      documents.forEach((doc: any, idx: number) => {
        if (!doc.terms?.delivery_weeks) missingFields.push(`Document ${idx}: delivery_weeks`)
        if (!doc.terms?.warranty_months) missingFields.push(`Document ${idx}: warranty_months`)
        if (!doc.line_items || doc.line_items.length === 0) missingFields.push(`Document ${idx}: line_items`)
      })

      return new Response(
        JSON.stringify({
          error: 'DIAGNOSTIC: Extraction returned no usable fields; blocking compose',
          missing_fields: missingFields,
          fragments_searched: parsedFragments.map(f => ({ 
            source: f.source, 
            preview: (f.text || JSON.stringify(f.table || '')).substring(0, 150) 
          })),
          notes: notes,
          documents_extracted: documents
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Convert to legacy format for backward compatibility
    const firstDoc = documents[0]
    const items = (firstDoc.line_items || []).map((item: any) => ({
      name: item.name || null,
      name_original: item.name || null,
      part_number: null,
      qty: item.qty,
      unit: item.unit,
      price: item.unit_price,
      delivery: null,
      warranty: null,
      source: item.source
    }))

    const extractedData = {
      language_detected: 'unknown',
      supplier: firstDoc.supplier || null,
      document_type: null,
      date: null,
      currency: firstDoc.currency || null,
      items: items,
      terms: {
        payment: firstDoc.terms?.payment_terms,
        penalties: null,
        validity: null,
        location: null,
        contact: null,
        delivery_weeks: firstDoc.terms?.delivery_weeks,
        warranty_months: firstDoc.terms?.warranty_months,
        source: firstDoc.terms?.source_terms
      },
      technical_specs: null,
      certifications: []
    }
    
    // Calculate totals from the extracted items
    const totalPrice = items.reduce((sum: number, item: any) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0)
    
    // Extract technical specifications and certifications
    const technicalSpecs = extractedData.technical_specs || {}
    const certifications = extractedData.certifications || []
    const issues: string[] = []
    const clarifications: string[] = []
    
    // Validate critical fields and track clarifications needed
    if (!extractedData.terms?.delivery_weeks) {
      issues.push("Delivery time not specified")
      clarifications.push("delivery_weeks: Please provide the delivery time in weeks")
    }
    if (!extractedData.terms?.warranty_months) {
      issues.push("Warranty information not specified")
      clarifications.push("warranty_months: Please specify the warranty period in months")
    }
    if (!certifications || certifications.length === 0) {
      issues.push("ISO certification not mentioned")
    }
    if (!extractedData.terms?.payment) {
      issues.push("Payment terms not specified")
      clarifications.push("payment_terms: Please provide the payment terms (e.g., Net 30, advance payment)")
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
      issues: issues,
      clarifications: clarifications
    }
    
    console.log('=== VENDOR DATA PROCESSED ===')
    console.log('Vendor name:', vendorData.vendor_name)
    console.log('Items count:', vendorData.items_count)
    console.log('Total price:', vendorData.quoted_total)
    console.log('Issues count:', vendorData.issues.length)
    console.log('Processed vendor data preview:', JSON.stringify(vendorData).substring(0, 200))

    console.log('=== RETURNING SUCCESS ===')
    return new Response(
      JSON.stringify({ 
        success: true,
        vendor_data: vendorData,
        raw_extraction: extractedData,
        extraction_notes: notes
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('=== DOCUMENT-PROCESSOR FATAL ERROR ===')
    console.error('Error type:', error?.constructor?.name)
    console.error('Error message:', error instanceof Error ? error.message : 'Unknown')
    console.error('Error stack:', error instanceof Error ? error.stack : 'No stack')
    console.error('Full error:', error)
    
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
