import { supabase } from "@/integrations/supabase/client";

export interface OCRResult {
  document_id: string;
  extracted_text: string;
  confidence: number;
  line_items: BOMItem[];
  normalization_applied: {
    text_normalization: boolean;
    synonym_mapping: boolean;
  };
  temp_file_path: string;
  message: string;
}

export interface BOMItem {
  item: string;
  quantity: number;
  unit_price: number;
  total_price?: number;
  part_number?: string;
  description?: string;
  category?: string;
}

export interface BOMExtractionResult {
  bill_of_materials: BOMItem[];
  summary: {
    total_items: number;
    total_quantity: number;
    total_value: number;
    categories: Record<string, number>;
  };
  extraction_method: string;
  confidence: number;
  message: string;
}

export interface NormalizationOptions {
  removeWhitespace?: boolean;
  convertToLowercase?: boolean;
  applySynonymMapping?: boolean;
  standardizeUnits?: boolean;
  validateDataTypes?: boolean;
  removeDuplicates?: boolean;
}

export interface NormalizationResult {
  original: any;
  normalized: any;
  normalization_report: {
    changes: Array<{
      path: string;
      from: any;
      to: any;
      type: string;
    }>;
    warnings: string[];
    statistics: Record<string, any>;
  };
  techniques_applied: NormalizationOptions;
  validation_summary?: {
    valid_items: number;
    invalid_items: number;
    warnings: string[];
  };
  cleaned_data?: any[];
  message: string;
}

class AdvancedDocumentAPI {
  private baseUrl: string;

  constructor() {
    this.baseUrl = 'https://***REMOVED***.supabase.co/functions/v1';
  }

  private async getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    const anonKey = '***REMOVED***';
    
    if (!session?.access_token) {
      throw new Error('User not authenticated');
    }

    return {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': anonKey,
      'Content-Type': 'application/json'
    };
  }

  /**
   * Advanced document processing with OCR simulation and normalization
   * Equivalent to Python FastAPI file upload with external service integration
   */
  async processDocumentAdvanced(
    file: File, 
    options: {
      applyNormalization?: boolean;
      applySynonymMapping?: boolean;
    } = {}
  ): Promise<OCRResult> {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      throw new Error('User not authenticated');
    }

    const formData = new FormData();
    formData.append('file', file);
    formData.append('options', JSON.stringify(options));

    console.log(`Processing document: ${file.name} with advanced OCR simulation`);

    const response = await fetch(`${this.baseUrl}/document-processor`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Processing failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`Document processed successfully. Extracted ${result.line_items?.length || 0} line items`);
    
    return result;
  }

  /**
   * Extract Bill of Materials from OCR JSON output
   * Equivalent to Python function for identifying and extracting line items
   */
  async extractBillOfMaterials(ocrData: {
    text: string;
    confidence?: number;
    tables?: any[];
  }): Promise<BOMExtractionResult> {
    const headers = await this.getAuthHeaders();

    console.log('Extracting Bill of Materials from OCR data');

    const response = await fetch(`${this.baseUrl}/extract-bom`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ ocr_data: ocrData })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `BOM extraction failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`Extracted ${result.bill_of_materials?.length || 0} BOM items`);
    
    return result;
  }

  /**
   * Apply comprehensive data normalization techniques
   * Equivalent to Python data normalization functions
   */
  async normalizeTextData(
    textData: any,
    options: NormalizationOptions = {}
  ): Promise<NormalizationResult> {
    const headers = await this.getAuthHeaders();

    console.log('Applying data normalization techniques');

    const response = await fetch(`${this.baseUrl}/normalize-data`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ 
        text_data: textData,
        options: {
          removeWhitespace: true,
          convertToLowercase: false,
          applySynonymMapping: true,
          standardizeUnits: true,
          validateDataTypes: true,
          removeDuplicates: false,
          ...options
        }
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Normalization failed: ${response.statusText}`);
    }

    const result = await response.json();
    console.log(`Applied ${result.normalization_report?.changes?.length || 0} normalization changes`);
    
    return result;
  }

  /**
   * Complete document processing pipeline
   * Combines file upload, OCR, BOM extraction, and normalization
   */
  async processDocumentComplete(
    file: File,
    options: {
      extractBOM?: boolean;
      normalizeData?: boolean;
      normalizationOptions?: NormalizationOptions;
    } = {}
  ): Promise<{
    ocr_result: OCRResult;
    bom_result?: BOMExtractionResult;
    normalization_result?: NormalizationResult;
  }> {
    console.log('Starting complete document processing pipeline');

    // Step 1: Advanced OCR processing
    const ocrResult = await this.processDocumentAdvanced(file, {
      applyNormalization: options.normalizeData !== false,
      applySynonymMapping: true
    });

    const results: any = {
      ocr_result: ocrResult
    };

    // Step 2: Extract BOM if requested and text contains line items
    if (options.extractBOM !== false && ocrResult.line_items?.length > 0) {
      try {
        const bomResult = await this.extractBillOfMaterials({
          text: ocrResult.extracted_text,
          confidence: ocrResult.confidence
        });
        results.bom_result = bomResult;
      } catch (error) {
        console.warn('BOM extraction failed:', error);
      }
    }

    // Step 3: Additional normalization if requested
    if (options.normalizeData && ocrResult.line_items?.length > 0) {
      try {
        const normalizationResult = await this.normalizeTextData(
          ocrResult.line_items,
          options.normalizationOptions
        );
        results.normalization_result = normalizationResult;
      } catch (error) {
        console.warn('Additional normalization failed:', error);
      }
    }

    console.log('Document processing pipeline completed');
    return results;
  }

  /**
   * Utility functions for data validation and cleaning
   */
  validatePartNumbers(partNumbers: string[]): string[] {
    return partNumbers.map(pn => {
      return pn
        .trim()
        .toUpperCase()
        .replace(/\s+/g, '-')
        .replace(/[^A-Z0-9-]/g, '')
        .replace(/-+/g, '-')
        .replace(/^-|-$/g, '');
    });
  }

  normalizePrices(prices: (string | number)[]): number[] {
    return prices.map(price => {
      if (typeof price === 'number') {
        return Math.round(price * 100) / 100;
      }
      
      const cleaned = price.toString().replace(/[$,\s]/g, '');
      const parsed = parseFloat(cleaned);
      return isNaN(parsed) ? 0 : Math.round(parsed * 100) / 100;
    });
  }

  normalizeQuantities(quantities: (string | number)[]): number[] {
    return quantities.map(qty => {
      if (typeof qty === 'number') {
        return Math.max(0, Math.floor(qty));
      }
      
      const cleaned = qty.toString().replace(/[^\d]/g, '');
      const parsed = parseInt(cleaned, 10);
      return isNaN(parsed) ? 0 : Math.max(0, parsed);
    });
  }

  /**
   * Demonstration of common data normalization techniques
   */
  demonstrateNormalizationTechniques(): {
    techniques: string[];
    examples: Record<string, { before: string; after: string; description: string }>;
  } {
    return {
      techniques: [
        'Whitespace removal and normalization',
        'Case conversion and standardization',
        'Synonym mapping and standardization',
        'Unit standardization',
        'Data type validation',
        'Duplicate removal',
        'Part number normalization',
        'Price and quantity validation'
      ],
      examples: {
        whitespace: {
          before: '  Circuit    Board   Assembly  \n\n  ',
          after: 'Circuit Board Assembly',
          description: 'Remove excessive whitespace, tabs, and normalize spacing'
        },
        synonyms: {
          before: 'LED Indicator Red',
          after: 'light emitting diode Red',
          description: 'Map common variations to standard terms'
        },
        units: {
          before: '100 micro farad',
          after: '100μF',
          description: 'Standardize unit representations'
        },
        partNumbers: {
          before: 'CB-1001  Rev A',
          after: 'CB-1001-REV-A',
          description: 'Normalize part number format'
        },
        prices: {
          before: '$1,234.56 USD',
          after: '1234.56',
          description: 'Extract and normalize numeric price values'
        }
      }
    };
  }
}

export const advancedDocumentApi = new AdvancedDocumentAPI();