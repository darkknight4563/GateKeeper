export interface DocumentUploadResponse {
  id: string;
  filename: string;
  extracted_text: string;
  status: 'processing' | 'completed' | 'error';
}

export interface BillOfMaterialsItem {
  item: string;
  quantity: number;
  unit_price: number;
}

export interface DocumentAnalysisResult {
  bill_of_materials: BillOfMaterialsItem[];
  normalized_data: Record<string, any>;
  raw_ocr_data: any;
}

class DocumentAPI {
  private baseUrl: string;

  constructor(baseUrl: string = 'http://localhost:8000') {
    this.baseUrl = baseUrl;
  }

  async uploadDocument(file: File): Promise<DocumentUploadResponse> {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${this.baseUrl}/upload-document/`, {
      method: 'POST',
      body: formData,
    });

    if (!response.ok) {
      throw new Error(`Upload failed: ${response.statusText}`);
    }

    return response.json();
  }

  async getDocumentAnalysis(documentId: string): Promise<DocumentAnalysisResult> {
    const response = await fetch(`${this.baseUrl}/analyze-document/${documentId}`);
    
    if (!response.ok) {
      throw new Error(`Analysis failed: ${response.statusText}`);
    }

    return response.json();
  }

  async extractBillOfMaterials(ocrData: any): Promise<BillOfMaterialsItem[]> {
    const response = await fetch(`${this.baseUrl}/extract-bom/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ocr_data: ocrData }),
    });

    if (!response.ok) {
      throw new Error(`BOM extraction failed: ${response.statusText}`);
    }

    const result = await response.json();
    return result.bill_of_materials;
  }

  async normalizeTextData(textData: Record<string, string>): Promise<Record<string, string>> {
    const response = await fetch(`${this.baseUrl}/normalize-text/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(textData),
    });

    if (!response.ok) {
      throw new Error(`Text normalization failed: ${response.statusText}`);
    }

    return response.json();
  }
}

export const documentApi = new DocumentAPI();