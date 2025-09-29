import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

interface NormalizationOptions {
  removeWhitespace: boolean;
  convertToLowercase: boolean;
  applySynonymMapping: boolean;
  standardizeUnits: boolean;
  validateDataTypes: boolean;
  removeDuplicates: boolean;
}

interface TextData {
  [key: string]: any;
}

class DataNormalizer {
  
  // Main normalization function
  static normalizeTextData(
    data: TextData, 
    options: Partial<NormalizationOptions> = {}
  ): { normalized: TextData; report: NormalizationReport } {
    const defaultOptions: NormalizationOptions = {
      removeWhitespace: true,
      convertToLowercase: false,
      applySynonymMapping: true,
      standardizeUnits: true,
      validateDataTypes: true,
      removeDuplicates: false
    };
    
    const opts = { ...defaultOptions, ...options };
    const report: NormalizationReport = {
      changes: [],
      warnings: [],
      statistics: {}
    };
    
    const normalized = JSON.parse(JSON.stringify(data)); // Deep clone
    
    // Apply normalization techniques
    this.processObject(normalized, opts, report, '');
    
    return { normalized, report };
  }

  private static processObject(
    obj: any, 
    options: NormalizationOptions, 
    report: NormalizationReport, 
    path: string
  ): void {
    if (Array.isArray(obj)) {
      this.processArray(obj, options, report, path);
    } else if (typeof obj === 'object' && obj !== null) {
      for (const [key, value] of Object.entries(obj)) {
        const currentPath = path ? `${path}.${key}` : key;
        
        if (typeof value === 'string') {
          const original = value;
          obj[key] = this.normalizeString(value, options);
          
          if (original !== obj[key]) {
            report.changes.push({
              path: currentPath,
              from: original,
              to: obj[key],
              type: 'string_normalization'
            });
          }
        } else if (typeof value === 'object') {
          this.processObject(value, options, report, currentPath);
        }
      }
    }
  }

  private static processArray(
    arr: any[], 
    options: NormalizationOptions, 
    report: NormalizationReport, 
    path: string
  ): void {
    const originalLength = arr.length;
    
    // Process each item
    arr.forEach((item, index) => {
      this.processObject(item, options, report, `${path}[${index}]`);
    });
    
    // Remove duplicates if requested
    if (options.removeDuplicates) {
      const seen = new Set();
      const filtered = arr.filter(item => {
        const key = typeof item === 'object' ? JSON.stringify(item) : item;
        if (seen.has(key)) {
          return false;
        }
        seen.add(key);
        return true;
      });
      
      if (filtered.length !== originalLength) {
        arr.length = 0;
        arr.push(...filtered);
        report.changes.push({
          path,
          from: `${originalLength} items`,
          to: `${filtered.length} items`,
          type: 'duplicate_removal'
        });
      }
    }
  }

  // Core string normalization
  private static normalizeString(text: string, options: NormalizationOptions): string {
    let normalized = text;
    
    // 1. Remove excessive whitespace
    if (options.removeWhitespace) {
      normalized = normalized
        .trim()
        .replace(/\s+/g, ' ') // Multiple spaces to single space
        .replace(/\n\s*\n/g, '\n') // Multiple newlines to single
        .replace(/\t/g, ' '); // Tabs to spaces
    }
    
    // 2. Convert case
    if (options.convertToLowercase) {
      normalized = normalized.toLowerCase();
    }
    
    // 3. Apply synonym mapping
    if (options.applySynonymMapping) {
      normalized = this.applySynonymMapping(normalized);
    }
    
    // 4. Standardize units
    if (options.standardizeUnits) {
      normalized = this.standardizeUnits(normalized);
    }
    
    return normalized;
  }

  // Synonym mapping for common variations
  private static applySynonymMapping(text: string): string {
    const synonymMap: Record<string, string> = {
      // Electronic components
      'resistor pack': 'resistor array',
      'led indicator': 'light emitting diode',
      'circuit board': 'pcb',
      'printed circuit board': 'pcb',
      
      // Connectors
      'connector 4-pin': '4-pin connector',
      'connector 4pin': '4-pin connector',
      '4 pin connector': '4-pin connector',
      
      // Power components
      'power supply': 'psu',
      'power supply unit': 'psu',
      
      // Hardware
      'stainless steel screws': 'ss screws',
      'stainless screws': 'ss screws',
      'aluminum housing': 'al housing',
      'aluminium housing': 'al housing',
      
      // Memory and storage
      'memory module': 'ram',
      'random access memory': 'ram',
      
      // Common abbreviations
      'microcontroller unit': 'mcu',
      'integrated circuit': 'ic',
      'light emitting diode': 'led',
      
      // Units standardization
      'ohms': 'Ω',
      'ohm': 'Ω',
      'microfarad': 'μF',
      'microfarads': 'μF',
      'milliamp': 'mA',
      'milliamps': 'mA',
      'milliampere': 'mA',
      'milliamperes': 'mA'
    };

    let normalized = text.toLowerCase();
    
    // Apply exact matches first
    for (const [variant, standard] of Object.entries(synonymMap)) {
      const regex = new RegExp(`\\b${variant.toLowerCase()}\\b`, 'gi');
      normalized = normalized.replace(regex, standard);
    }
    
    return normalized;
  }

  // Standardize unit representations
  private static standardizeUnits(text: string): string {
    const unitPatterns = [
      // Electrical units
      { pattern: /(\d+)\s*(k|kilo)\s*(ohm|Ω)/gi, replacement: '$1kΩ' },
      { pattern: /(\d+)\s*(m|milli)\s*(amp|a)/gi, replacement: '$1mA' },
      { pattern: /(\d+)\s*(micro|µ|u)\s*(farad|f)/gi, replacement: '$1μF' },
      { pattern: /(\d+)\s*(nano|n)\s*(farad|f)/gi, replacement: '$1nF' },
      { pattern: /(\d+)\s*(pico|p)\s*(farad|f)/gi, replacement: '$1pF' },
      
      // Physical dimensions
      { pattern: /(\d+)\s*(milli|mm)\s*(meter|m)/gi, replacement: '$1mm' },
      { pattern: /(\d+)\s*(centi|cm)\s*(meter|m)/gi, replacement: '$1cm' },
      { pattern: /(\d+)\s*(inch|in|")/gi, replacement: '$1"' },
      
      // Voltage and current
      { pattern: /(\d+)\s*(volt|v)\b/gi, replacement: '$1V' },
      { pattern: /(\d+)\s*(amp|ampere|a)\b/gi, replacement: '$1A' },
      { pattern: /(\d+)\s*(watt|w)\b/gi, replacement: '$1W' },
      
      // Frequencies
      { pattern: /(\d+)\s*(hertz|hz)\b/gi, replacement: '$1Hz' },
      { pattern: /(\d+)\s*(kilo|k)\s*(hertz|hz)/gi, replacement: '$1kHz' },
      { pattern: /(\d+)\s*(mega|m)\s*(hertz|hz)/gi, replacement: '$1MHz' },
      { pattern: /(\d+)\s*(giga|g)\s*(hertz|hz)/gi, replacement: '$1GHz' }
    ];

    let normalized = text;
    
    for (const { pattern, replacement } of unitPatterns) {
      normalized = normalized.replace(pattern, replacement);
    }
    
    return normalized;
  }

  // Advanced normalization techniques
  static normalizePartNumbers(partNumbers: string[]): string[] {
    return partNumbers.map(pn => {
      return pn
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '-') // Replace spaces with hyphens
        .replace(/[^A-Z0-9-]/g, '') // Keep only alphanumeric and hyphens
        .replace(/-+/g, '-') // Multiple hyphens to single
        .replace(/^-|-$/g, ''); // Remove leading/trailing hyphens
    });
  }

  static normalizePrices(prices: (string | number)[]): number[] {
    return prices.map(price => {
      if (typeof price === 'number') {
        return Math.round(price * 100) / 100; // Round to 2 decimal places
      }
      
      const cleaned = price.toString().replace(/[$,\s]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
    });
  }

  static normalizeQuantities(quantities: (string | number)[]): number[] {
    return quantities.map(qty => {
      if (typeof qty === 'number') {
        return Math.max(0, Math.floor(qty)); // Ensure positive integers
      }
      
      const cleaned = qty.toString().replace(/[^\d]/g, '');
      const parsed = parseInt(cleaned, 10);
      return isNaN(parsed) ? 0 : Math.max(0, parsed);
    });
  }

  // Data validation and cleaning
  static validateAndCleanData(data: any[]): { valid: any[]; invalid: any[]; warnings: string[] } {
    const valid = [];
    const invalid = [];
    const warnings = [];

    for (const item of data) {
      const issues = this.validateItem(item);
      
      if (issues.length === 0) {
        valid.push(item);
      } else if (issues.some(issue => issue.severity === 'error')) {
        invalid.push({ ...item, _validation_errors: issues });
        warnings.push(`Invalid item "${item.item || 'unknown'}": ${issues.map(i => i.message).join(', ')}`);
      } else {
        // Only warnings, include but flag
        valid.push({ ...item, _validation_warnings: issues });
        warnings.push(`Item "${item.item || 'unknown'}" has warnings: ${issues.map(i => i.message).join(', ')}`);
      }
    }

    return { valid, invalid, warnings };
  }

  private static validateItem(item: any): Array<{ severity: 'warning' | 'error'; message: string }> {
    const issues: Array<{ severity: 'warning' | 'error'; message: string }> = [];

    // Required fields
    if (!item.item || typeof item.item !== 'string') {
      issues.push({ severity: 'error' as const, message: 'Missing or invalid item name' });
    }

    if (!item.quantity || typeof item.quantity !== 'number' || item.quantity <= 0) {
      issues.push({ severity: 'error' as const, message: 'Missing or invalid quantity' });
    }

    if (!item.unit_price || typeof item.unit_price !== 'number' || item.unit_price <= 0) {
      issues.push({ severity: 'error' as const, message: 'Missing or invalid unit price' });
    }

    // Warnings for unusual values
    if (item.quantity && item.quantity > 10000) {
      issues.push({ severity: 'warning' as const, message: 'Unusually high quantity' });
    }

    if (item.unit_price && item.unit_price > 1000) {
      issues.push({ severity: 'warning' as const, message: 'Unusually high unit price' });
    }

    if (item.item && item.item.length < 3) {
      issues.push({ severity: 'warning' as const, message: 'Very short item name' });
    }

    return issues;
  }
}

interface NormalizationReport {
  changes: Array<{
    path: string;
    from: any;
    to: any;
    type: string;
  }>;
  warnings: string[];
  statistics: Record<string, any>;
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
      const { text_data, options = {} } = await req.json()

      if (!text_data) {
        return new Response(
          JSON.stringify({ error: 'Text data required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log('Applying data normalization techniques...')

      // Apply comprehensive normalization
      const { normalized, report } = DataNormalizer.normalizeTextData(text_data, options)
      
      console.log(`Applied ${report.changes.length} normalization changes`)

      // Additional specialized normalizations if data contains arrays
      let specializedResults = {};
      
      if (Array.isArray(text_data)) {
        // Validate and clean array data
        const validation = DataNormalizer.validateAndCleanData(text_data);
        specializedResults = {
          validation_summary: {
            valid_items: validation.valid.length,
            invalid_items: validation.invalid.length,
            warnings: validation.warnings
          },
          cleaned_data: validation.valid
        };
      }

      return new Response(
        JSON.stringify({
          original: text_data,
          normalized,
          normalization_report: report,
          ...specializedResults,
          techniques_applied: {
            whitespace_removal: options.removeWhitespace !== false,
            case_conversion: options.convertToLowercase || false,
            synonym_mapping: options.applySynonymMapping !== false,
            unit_standardization: options.standardizeUnits !== false,
            data_validation: options.validateDataTypes !== false,
            duplicate_removal: options.removeDuplicates || false
          },
          message: 'Data normalization completed successfully'
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