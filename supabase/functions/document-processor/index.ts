import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface OCRResult {
  confidence: number;
  text: string;
  bbox: [number, number, number, number];
  line_items?: LineItem[];
}

interface LineItem {
  item: string;
  quantity: number;
  unit_price: number;
  description?: string;
  part_number?: string;
}

// Simulated OCR text extraction (replace with actual OCR service like Azure Document Intelligence)
class TextExtractor {
  async extractTextFromFile(fileBuffer: ArrayBuffer, mimeType: string): Promise<OCRResult> {
    // Simulate OCR processing delay
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Mock OCR text extraction based on file type
    const mockTexts = [
      `VENDOR QUOTE - TechSupply Corp
      Date: 2024-01-15
      Quote #: TS-2024-001
      
      BILL OF MATERIALS:
      Item Description          Part No.    Qty    Unit Price    Total
      Circuit Board Assembly    CB-1001     25     $45.00       $1,125.00
      Resistor Pack 10K         R-10K-P     100    $0.15        $15.00
      Capacitor 100uF           C-100UF     50     $0.85        $42.50
      LED Indicator Red         LED-R-5MM   200    $0.12        $24.00
      Connector 4-Pin           CONN-4P     30     $2.50        $75.00
      
      Subtotal: $1,281.50
      Tax: $102.52
      Total: $1,384.02`,
      
      `PROPOSAL - Global Electronics Ltd
      Proposal ID: GEL-2024-0023
      Valid Until: 2024-02-15
      
      PARTS LIST:
      Description               SKU         Quantity  Price Each   Extended
      Microcontroller Unit      MCU-ARM32   10        $28.50      $285.00
      Memory Module 4GB         MEM-4GB     15        $12.75      $191.25
      Power Supply 12V 2A       PSU-12V2A   8         $18.90      $151.20
      Heat Sink Aluminum        HS-AL-40    20        $3.25       $65.00
      Cable Assembly 1M         CABLE-1M    25        $4.80       $120.00
      
      Subtotal: $812.45
      Shipping: $45.00
      TOTAL: $857.45`,
      
      `QUOTATION - Precision Manufacturing
      Quote Reference: PM-Q-2024-007
      Customer: [Customer Name]
      
      MATERIAL REQUIREMENTS:
      Item                      Code        Req'd    Unit Cost    Amount
      Aluminum Housing          ALU-HOUS    12       $67.50      $810.00
      Stainless Screws M4       SS-M4-20    144      $0.08       $11.52
      Gasket Rubber O-Ring      GAS-OR-25   24       $1.45       $34.80
      Label Serial Number       LBL-SN      12       $0.95       $11.40
      Coating Anti-Corrosion    COAT-AC     1        $125.00     $125.00
      
      Net Total: $992.72
      Delivery: 10-14 days`
    ];
    
    const selectedText = mockTexts[Math.floor(Math.random() * mockTexts.length)];
    
    return {
      confidence: 0.92 + Math.random() * 0.08,
      text: selectedText,
      bbox: [0, 0, 100, 100], // Mock bounding box
      line_items: await this.extractLineItems(selectedText)
    };
  }

  private async extractLineItems(text: string): Promise<LineItem[]> {
    const lines = text.split('\n');
    const lineItems: LineItem[] = [];
    
    // Patterns to match bill of materials entries
    const patterns = [
      // Pattern 1: Item Description | Part No. | Qty | Unit Price | Total
      /^(.+?)\s+([A-Z0-9-]+)\s+(\d+)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)$/,
      // Pattern 2: Description | SKU | Quantity | Price Each | Extended
      /^(.+?)\s+([A-Z0-9-]+)\s+(\d+)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)$/,
      // Pattern 3: Item | Code | Req'd | Unit Cost | Amount
      /^(.+?)\s+([A-Z0-9-]+)\s+(\d+)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)$/
    ];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip headers and empty lines
      if (!trimmedLine || 
          trimmedLine.includes('Description') || 
          trimmedLine.includes('Item') ||
          trimmedLine.includes('Subtotal') ||
          trimmedLine.includes('Total') ||
          trimmedLine.includes('Tax') ||
          trimmedLine.includes('----')) {
        continue;
      }
      
      for (const pattern of patterns) {
        const match = trimmedLine.match(pattern);
        if (match) {
          const [, description, partNumber, quantityStr, unitPriceStr] = match;
          
          const quantity = parseInt(quantityStr, 10);
          const unitPrice = parseFloat(unitPriceStr.replace(/,/g, ''));
          
          if (!isNaN(quantity) && !isNaN(unitPrice) && quantity > 0 && unitPrice > 0) {
            lineItems.push({
              item: description.trim(),
              quantity,
              unit_price: unitPrice,
              description: description.trim(),
              part_number: partNumber.trim()
            });
          }
          break;
        }
      }
    }
    
    return lineItems;
  }
}

// Data normalization utilities
class DataNormalizer {
  static normalizeText(text: string): string {
    return text
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/[^\w\s-]/g, '') // Remove special characters except hyphens
  }

  static normalizePartNumber(partNumber: string): string {
    return partNumber
      .trim()
      .toUpperCase()
      .replace(/\s+/g, '-') // Replace spaces with hyphens
      .replace(/[^A-Z0-9-]/g, '') // Keep only alphanumeric and hyphens
  }

  static normalizePrice(priceStr: string): number {
    const cleaned = priceStr.replace(/[$,\s]/g, '');
    const price = parseFloat(cleaned);
    return isNaN(price) ? 0 : Math.round(price * 100) / 100; // Round to 2 decimal places
  }

  static applyTextNormalization(items: LineItem[]): LineItem[] {
    return items.map(item => ({
      ...item,
      item: this.normalizeText(item.item),
      description: item.description ? this.normalizeText(item.description) : undefined,
      part_number: item.part_number ? this.normalizePartNumber(item.part_number) : undefined,
      unit_price: this.normalizePrice(item.unit_price.toString())
    }));
  }

  // Synonym mapping for common variations
  static applySynonymMapping(text: string): string {
    const synonymMap: Record<string, string> = {
      'resistor pack': 'resistor array',
      'led indicator': 'light emitting diode',
      'connector 4-pin': '4-pin connector',
      'circuit board': 'pcb',
      'power supply': 'psu',
      'heat sink': 'heatsink',
      'aluminum housing': 'al housing',
      'stainless screws': 'ss screws'
    };

    let normalized = text.toLowerCase();
    for (const [variant, standard] of Object.entries(synonymMap)) {
      normalized = normalized.replace(new RegExp(variant, 'gi'), standard);
    }
    
    return normalized;
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the user
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (req.method === 'POST') {
      const formData = await req.formData()
      const file = formData.get('file') as File
      const options = JSON.parse(formData.get('options') as string || '{}')

      if (!file) {
        return new Response(
          JSON.stringify({ error: 'No file provided' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log(`Processing file: ${file.name}, size: ${file.size}, type: ${file.type}`)

      // Save file to temporary storage (simulate)
      const fileBuffer = await file.arrayBuffer()
      const tempFilePath = `temp/${user.id}/${Date.now()}-${file.name}`
      
      console.log(`File saved to temporary path: ${tempFilePath}`)

      // Extract text using OCR simulation
      const extractor = new TextExtractor()
      const ocrResult = await extractor.extractTextFromFile(fileBuffer, file.type)
      
      console.log(`OCR extraction completed. Confidence: ${ocrResult.confidence}, Line items: ${ocrResult.line_items?.length || 0}`)

      // Apply data normalization
      let normalizedItems = ocrResult.line_items || []
      
      if (options.applyNormalization !== false) {
        normalizedItems = DataNormalizer.applyTextNormalization(normalizedItems)
        console.log('Applied text normalization')
      }

      if (options.applySynonymMapping) {
        normalizedItems = normalizedItems.map(item => ({
          ...item,
          item: DataNormalizer.applySynonymMapping(item.item),
          description: item.description ? DataNormalizer.applySynonymMapping(item.description) : undefined
        }))
        console.log('Applied synonym mapping')
      }

      // Store processing result in database
      const { data: document, error: docError } = await supabase
        .from('documents')
        .insert({
          filename: file.name,
          file_path: tempFilePath,
          file_size: file.size,
          mime_type: file.type,
          upload_status: 'completed',
          user_id: user.id
        })
        .select()
        .single()

      if (docError) {
        console.error('Database error:', docError)
        return new Response(
          JSON.stringify({ error: 'Failed to save document metadata' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      return new Response(
        JSON.stringify({
          document_id: document.id,
          extracted_text: ocrResult.text,
          confidence: ocrResult.confidence,
          line_items: normalizedItems,
          normalization_applied: {
            text_normalization: options.applyNormalization !== false,
            synonym_mapping: options.applySynonymMapping || false
          },
          temp_file_path: tempFilePath,
          message: 'Document processed successfully with OCR and normalization'
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ 
        error: 'Internal server error',
        details: error instanceof Error ? error.message : 'Unknown error'
      }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})