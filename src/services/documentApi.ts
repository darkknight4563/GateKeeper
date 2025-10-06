import { supabase } from "@/integrations/supabase/client";

export interface DocumentUploadResponse {
  id: string;
  filename: string;
  status: 'pending' | 'processing' | 'completed' | 'error';
  job_id?: string;
  message?: string;
}

export interface VendorData {
  id: string;
  vendorName: string;
  quotedPrice: number;
  calculatedTCO: number;
  leadTime: number;
  riskScore: number;
  items: number;
  currency: string;
  riskFactors: string[];
  tcoBreakdown: {
    quotedPrice: number;
    shippingCosts: number;
    handlingFees: number;
    riskPremium: number;
    qualityAdjustment: number;
  };
  technicalSpecs?: {
    tubes?: number;
    fibers?: number;
    outerDiameter?: string;
    weight?: string;
    bendRadius?: string;
    length?: string;
    specification?: string;
    certification?: string;
    standards?: string[];
    certifications?: string[];
  };
  issues?: string[];
}

export interface ProcessingResults {
  job_id: string;
  status: string;
  results: VendorData[];
  summary: {
    totalVendors: number;
    recommendedVendor: string | null;
    avgTCO: number;
    highRiskCount: number;
  };
}

class DocumentAPI {
  private baseUrl: string;

  constructor() {
    this.baseUrl = 'https://***REMOVED***.supabase.co/functions/v1';
  }

  private async getAuthHeaders() {
    const { data: { session } } = await supabase.auth.getSession();
    const anonKey = '***REMOVED***';
    
    if (!session?.access_token) {
      throw new Error('Please log in to process documents');
    }

    return {
      'Authorization': `Bearer ${session.access_token}`,
      'apikey': anonKey,
      'Content-Type': 'application/json'
    };
  }

  private guessMime(filename: string): string {
    if (filename.endsWith('.pdf')) return 'application/pdf';
    if (filename.endsWith('.xlsx')) return 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';
    if (filename.endsWith('.xls')) return 'application/vnd.ms-excel';
    if (filename.endsWith('.csv')) return 'text/csv';
    return 'application/octet-stream';
  }

  async uploadDocument(file: File): Promise<DocumentUploadResponse> {
    const { data: { session } } = await supabase.auth.getSession();
    const anonKey = '***REMOVED***';
    
    if (!session?.access_token) {
      throw new Error('Please log in to upload documents');
    }

    // Validation guards
    if (!file || file.size === 0) {
      throw new Error('Empty file selected');
    }
    
    if (file.size > 50 * 1024 * 1024) {
      throw new Error('File exceeds 50MB limit');
    }

    // Convert file to base64
    const arrayBuf = await file.arrayBuffer();
    const b64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuf)));
    
    const payload = {
      filename: file.name,
      mime: file.type || this.guessMime(file.name),
      size: file.size,
      file_b64: b64
    };

    console.log(`Uploading ${file.name}: ${file.size} bytes, MIME: ${payload.mime}`);

    const response = await fetch(`${this.baseUrl}/upload-document`, {
      method: 'POST',
      mode: 'cors',
      credentials: 'omit',
      headers: {
        'Authorization': `Bearer ${session.access_token}`,
        'apikey': anonKey,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(payload)
    });

    if (!response.ok) {
      const txt = await response.text();
      throw new Error(`Upload failed: ${response.status} ${txt}`);
    }

    return response.json();
  }


  async getResults(jobId: string): Promise<ProcessingResults> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/get-results/${jobId}`, {
      method: 'GET',
      headers
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Failed to get results: ${response.statusText}`);
    }

    return response.json();
  }

  async pollJobStatus(jobId: string, onProgress?: (progress: number) => void): Promise<ProcessingResults> {
    const maxAttempts = 30; // 30 attempts with 2-second intervals = 1 minute max
    let attempts = 0;

    while (attempts < maxAttempts) {
      try {
        const result = await this.getResults(jobId);
        
        if (result.status === 'completed') {
          return result;
        }
        
        if (result.status === 'failed') {
          throw new Error('Document processing failed');
        }

        // Update progress if callback provided
        if (onProgress && 'progress' in result) {
          onProgress((result as any).progress || 0);
        }

        // Wait 2 seconds before next poll
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
        
      } catch (error) {
        if (attempts === maxAttempts - 1) {
          throw error;
        }
        await new Promise(resolve => setTimeout(resolve, 2000));
        attempts++;
      }
    }

    throw new Error('Processing timeout - please try again');
  }

  async generateReport(jobId: string): Promise<{ html: string; recommendation: string; filename: string }> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/generate-report`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ jobId })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Failed to generate report: ${response.statusText}`);
    }

    return response.json();
  }
}

export const documentApi = new DocumentAPI();