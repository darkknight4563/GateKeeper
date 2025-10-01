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
    
    if (!session?.access_token) {
      throw new Error('User not authenticated');
    }

    return {
      'Authorization': `Bearer ${session.access_token}`,
      'Content-Type': 'application/json'
    };
  }

  async uploadDocument(file: File): Promise<DocumentUploadResponse> {
    const { data: { session } } = await supabase.auth.getSession();
    
    if (!session?.access_token) {
      throw new Error('User not authenticated');
    }

    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/upload-document`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${session.access_token}`
      },
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Upload failed: ${response.statusText}`);
    }

    return response.json();
  }

  async processDocument(documentId: string): Promise<{ job_id: string; status: string; message: string }> {
    const headers = await this.getAuthHeaders();

    const response = await fetch(`${this.baseUrl}/process-document`, {
      method: 'POST',
      headers,
      body: JSON.stringify({ document_id: documentId })
    });
    
    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error || `Processing failed: ${response.statusText}`);
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