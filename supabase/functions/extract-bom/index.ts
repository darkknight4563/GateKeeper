import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface BOMItem {
  item: string;
  quantity: number;
  unit_price: number;
  total_price?: number;
  part_number?: string;
  description?: string;
  category?: string;
}

interface OCRData {
  text: string;
  confidence?: number;
  tables?: any[];
}

class BillOfMaterialsExtractor {
  
  // Advanced BOM extraction from OCR JSON output
  static extractFromOCRData(ocrData: OCRData): BOMItem[] {
    const items: BOMItem[] = [];
    
    // Method 1: Extract from structured tables if available
    if (ocrData.tables && ocrData.tables.length > 0) {
      items.push(...this.extractFromTables(ocrData.tables));
    }
    
    // Method 2: Extract from raw text using pattern matching
    if (ocrData.text) {
      items.push(...this.extractFromText(ocrData.text));
    }
    
    // Remove duplicates and validate
    return this.deduplicateAndValidate(items);
  }

  private static extractFromTables(tables: any[]): BOMItem[] {
    const items: BOMItem[] = [];
    
    for (const table of tables) {
      if (table.rows && table.rows.length > 0) {
        // Find header row to identify column positions
        const headerRow = table.rows[0];
        const columnMap = this.mapColumns(headerRow.cells || []);
        
        // Process data rows
        for (let i = 1; i < table.rows.length; i++) {
          const row = table.rows[i];
          const item = this.extractItemFromRow(row.cells || [], columnMap);
          if (item) {
            items.push(item);
          }
        }
      }
    }
    
    return items;
  }

  private static mapColumns(headerCells: any[]): Record<string, number> {
    const columnMap: Record<string, number> = {};
    
    headerCells.forEach((cell, index) => {
      const text = (cell.text || '').toLowerCase().trim();
      
      // Map common column headers
      if (text.includes('item') || text.includes('description') || text.includes('part')) {
        columnMap.item = index;
      } else if (text.includes('quantity') || text.includes('qty')) {
        columnMap.quantity = index;
      } else if (text.includes('unit price') || text.includes('price') || text.includes('cost')) {
        columnMap.unit_price = index;
      } else if (text.includes('total') && !text.includes('unit')) {
        columnMap.total_price = index;
      } else if (text.includes('part number') || text.includes('sku') || text.includes('code')) {
        columnMap.part_number = index;
      }
    });
    
    return columnMap;
  }

  private static extractItemFromRow(cells: any[], columnMap: Record<string, number>): BOMItem | null {
    try {
      const getCell = (key: string) => {
        const index = columnMap[key];
        return index !== undefined && cells[index] ? cells[index].text || '' : '';
      };

      const item = getCell('item').trim();
      const quantityStr = getCell('quantity').trim();
      const priceStr = getCell('unit_price').trim();

      if (!item || !quantityStr || !priceStr) {
        return null;
      }

      const quantity = this.parseNumber(quantityStr);
      const unitPrice = this.parsePrice(priceStr);

      if (quantity <= 0 || unitPrice <= 0) {
        return null;
      }

      const bomItem: BOMItem = {
        item,
        quantity,
        unit_price: unitPrice,
        total_price: quantity * unitPrice
      };

      // Add optional fields
      const partNumber = getCell('part_number').trim();
      if (partNumber) {
        bomItem.part_number = partNumber;
      }

      const totalPrice = this.parsePrice(getCell('total_price'));
      if (totalPrice > 0) {
        bomItem.total_price = totalPrice;
      }

      return bomItem;
    } catch (error) {
      console.error('Error extracting item from row:', error);
      return null;
    }
  }

  private static extractFromText(text: string): BOMItem[] {
    const items: BOMItem[] = [];
    const lines = text.split('\n');
    
    // Enhanced patterns for different BOM formats
    const patterns = [
      // Standard format: Item | Part | Qty | Price | Total
      /^(.{20,}?)\s+([A-Z0-9-]{3,})\s+(\d+)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)$/,
      // Alternative format: Description | SKU | Quantity | Unit Price | Extended
      /^(.{15,}?)\s+([A-Z0-9-]{3,})\s+(\d+)\s+\$?([\d,]+\.?\d*)\s+\$?([\d,]+\.?\d*)$/,
      // Compact format: Item Code Qty Price
      /^(.{10,}?)\s+([A-Z0-9-]{3,})\s+(\d+)\s+\$?([\d,]+\.?\d*)$/,
      // Tab-separated format
      /^(.+?)\t([A-Z0-9-]+)\t(\d+)\t\$?([\d,]+\.?\d*)/,
      // Price-first format: $Price | Qty | Item | Part
      /^\$?([\d,]+\.?\d*)\s+(\d+)\s+(.{10,}?)\s+([A-Z0-9-]{3,})$/
    ];
    
    for (const line of lines) {
      const trimmedLine = line.trim();
      
      // Skip obvious non-data lines
      if (this.shouldSkipLine(trimmedLine)) {
        continue;
      }
      
      for (const pattern of patterns) {
        const match = trimmedLine.match(pattern);
        if (match) {
          const item = this.parseLineMatch(match, pattern);
          if (item) {
            items.push(item);
            break; // Move to next line once we found a match
          }
        }
      }
    }
    
    return items;
  }

  private static shouldSkipLine(line: string): boolean {
    const skipPatterns = [
      /^(description|item|part|quantity|qty|price|total|subtotal|tax|shipping)/i,
      /^[-=_\s]+$/,
      /^(date|quote|proposal|vendor|customer)/i,
      /^\s*$/,
      /^page\s+\d+/i
    ];
    
    return skipPatterns.some(pattern => pattern.test(line));
  }

  private static parseLineMatch(match: RegExpMatchArray, pattern: RegExp): BOMItem | null {
    try {
      // Different parsing based on pattern structure
      if (pattern.source.includes('Price.*Qty.*Item')) {
        // Price-first format: $Price | Qty | Item | Part
        const [, priceStr, quantityStr, item, partNumber] = match;
        return this.createBOMItem(item, quantityStr, priceStr, partNumber);
      } else {
        // Standard formats: Item | Part | Qty | Price [| Total]
        const [, item, partNumber, quantityStr, priceStr] = match;
        return this.createBOMItem(item, quantityStr, priceStr, partNumber);
      }
    } catch (error) {
      console.error('Error parsing line match:', error);
      return null;
    }
  }

  private static createBOMItem(
    item: string, 
    quantityStr: string, 
    priceStr: string, 
    partNumber?: string
  ): BOMItem | null {
    const quantity = this.parseNumber(quantityStr);
    const unitPrice = this.parsePrice(priceStr);
    
    if (!item.trim() || quantity <= 0 || unitPrice <= 0) {
      return null;
    }
    
    const bomItem: BOMItem = {
      item: item.trim(),
      quantity,
      unit_price: unitPrice,
      total_price: quantity * unitPrice
    };
    
    if (partNumber?.trim()) {
      bomItem.part_number = partNumber.trim();
    }
    
    // Categorize items based on common keywords
    bomItem.category = this.categorizeItem(item);
    
    return bomItem;
  }

  private static parseNumber(str: string): number {
    const cleaned = str.replace(/[^\d]/g, '');
    const num = parseInt(cleaned, 10);
    return isNaN(num) ? 0 : num;
  }

  private static parsePrice(str: string): number {
    const cleaned = str.replace(/[$,\s]/g, '');
    const price = parseFloat(cleaned);
    return isNaN(price) ? 0 : Math.round(price * 100) / 100;
  }

  private static categorizeItem(itemName: string): string {
    const name = itemName.toLowerCase();
    
    if (name.includes('resistor') || name.includes('capacitor') || name.includes('inductor')) {
      return 'passive_components';
    } else if (name.includes('ic') || name.includes('microcontroller') || name.includes('processor')) {
      return 'active_components';
    } else if (name.includes('connector') || name.includes('cable') || name.includes('wire')) {
      return 'connectivity';
    } else if (name.includes('housing') || name.includes('case') || name.includes('enclosure')) {
      return 'mechanical';
    } else if (name.includes('led') || name.includes('display') || name.includes('indicator')) {
      return 'display';
    } else if (name.includes('power') || name.includes('supply') || name.includes('battery')) {
      return 'power';
    } else if (name.includes('screw') || name.includes('bolt') || name.includes('fastener')) {
      return 'hardware';
    }
    
    return 'other';
  }

  private static deduplicateAndValidate(items: BOMItem[]): BOMItem[] {
    const seen = new Set<string>();
    const validated: BOMItem[] = [];
    
    for (const item of items) {
      // Create a unique key based on item name and part number
      const key = `${item.item.toLowerCase()}-${item.part_number || 'no-part'}`;
      
      if (!seen.has(key) && this.isValidItem(item)) {
        seen.add(key);
        validated.push(item);
      }
    }
    
    return validated.sort((a, b) => a.item.localeCompare(b.item));
  }

  private static isValidItem(item: BOMItem): boolean {
    // Validate basic requirements
    if (!item.item || item.item.length < 3) return false;
    if (item.quantity <= 0 || item.quantity > 100000) return false;
    if (item.unit_price <= 0 || item.unit_price > 10000) return false;
    
    // Filter out obvious non-items
    const name = item.item.toLowerCase();
    const invalidTerms = ['total', 'subtotal', 'tax', 'shipping', 'discount', 'page', 'date'];
    
    return !invalidTerms.some(term => name.includes(term));
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
      const { ocr_data } = await req.json()

      if (!ocr_data) {
        return new Response(
          JSON.stringify({ error: 'OCR data required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log('Extracting BOM from OCR data...')

      // Extract bill of materials from OCR data
      const billOfMaterials = BillOfMaterialsExtractor.extractFromOCRData(ocr_data)
      
      console.log(`Extracted ${billOfMaterials.length} BOM items`)

      // Calculate totals
      const summary = {
        total_items: billOfMaterials.length,
        total_quantity: billOfMaterials.reduce((sum, item) => sum + item.quantity, 0),
        total_value: billOfMaterials.reduce((sum, item) => sum + (item.total_price || 0), 0),
        categories: getCategorySummary(billOfMaterials)
      }

      return new Response(
        JSON.stringify({
          bill_of_materials: billOfMaterials,
          summary,
          extraction_method: 'advanced_pattern_matching',
          confidence: ocr_data.confidence || 0.85,
          message: `Successfully extracted ${billOfMaterials.length} line items`
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

  function getCategorySummary(items: BOMItem[]): Record<string, number> {
    const categories: Record<string, number> = {}
    
    for (const item of items) {
      const category = item.category || 'other'
      categories[category] = (categories[category] || 0) + 1
    }
    
    return categories
  }
})