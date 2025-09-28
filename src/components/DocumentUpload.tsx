import { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { documentApi, type DocumentUploadResponse, type BillOfMaterialsItem } from '@/services/documentApi';
import { useToast } from '@/hooks/use-toast';

const DocumentUpload = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<DocumentUploadResponse | null>(null);
  const [billOfMaterials, setBillOfMaterials] = useState<BillOfMaterialsItem[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.type !== 'application/pdf') {
      toast({
        title: "Invalid file type",
        description: "Please upload a PDF file",
        variant: "destructive"
      });
      return;
    }

    setIsUploading(true);
    try {
      const response = await documentApi.uploadDocument(file);
      setUploadedDoc(response);
      
      toast({
        title: "Document uploaded successfully",
        description: `${file.name} has been processed`,
      });

      // Auto-start analysis if document is ready
      if (response.status === 'completed') {
        await analyzeDocument(response.id);
      }
    } catch (error) {
      toast({
        title: "Upload failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive"
      });
    } finally {
      setIsUploading(false);
    }
  }, [toast]);

  const analyzeDocument = async (documentId: string) => {
    setIsAnalyzing(true);
    try {
      const analysis = await documentApi.getDocumentAnalysis(documentId);
      setBillOfMaterials(analysis.bill_of_materials);
      
      toast({
        title: "Analysis complete",
        description: `Extracted ${analysis.bill_of_materials.length} items from Bill of Materials`,
      });
    } catch (error) {
      toast({
        title: "Analysis failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive"
      });
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="h-4 w-4 text-success" />;
      case 'processing':
        return <Loader2 className="h-4 w-4 animate-spin text-azure" />;
      case 'error':
        return <AlertCircle className="h-4 w-4 text-destructive" />;
      default:
        return <FileText className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const getStatusColor = (status: string) => {
    switch (status) {
      case 'completed':
        return 'bg-success text-success-foreground';
      case 'processing':
        return 'bg-azure text-primary-foreground';
      case 'error':
        return 'bg-destructive text-destructive-foreground';
      default:
        return 'bg-muted text-muted-foreground';
    }
  };

  return (
    <div className="space-y-6">
      {/* Upload Section */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Upload className="h-5 w-5" />
            Document Upload
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="border-2 border-dashed border-border rounded-lg p-8 text-center">
            <input
              type="file"
              accept=".pdf"
              onChange={handleFileUpload}
              disabled={isUploading}
              className="hidden"
              id="file-upload"
            />
            <label
              htmlFor="file-upload"
              className="cursor-pointer flex flex-col items-center gap-4"
            >
              {isUploading ? (
                <Loader2 className="h-12 w-12 animate-spin text-azure" />
              ) : (
                <Upload className="h-12 w-12 text-muted-foreground" />
              )}
              <div>
                <p className="text-lg font-medium">
                  {isUploading ? 'Processing document...' : 'Upload PDF Document'}
                </p>
                <p className="text-muted-foreground">
                  Click to select or drag and drop your PDF file here
                </p>
              </div>
            </label>
          </div>
        </CardContent>
      </Card>

      {/* Document Status */}
      {uploadedDoc && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center justify-between">
              <span className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Document Status
              </span>
              <Badge className={getStatusColor(uploadedDoc.status)}>
                {getStatusIcon(uploadedDoc.status)}
                {uploadedDoc.status}
              </Badge>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div>
                <p className="font-medium">Filename:</p>
                <p className="text-muted-foreground">{uploadedDoc.filename}</p>
              </div>
              
              {uploadedDoc.status === 'completed' && !isAnalyzing && billOfMaterials.length === 0 && (
                <Button 
                  onClick={() => analyzeDocument(uploadedDoc.id)}
                  className="w-full"
                >
                  Analyze Document
                </Button>
              )}

              {isAnalyzing && (
                <div className="flex items-center gap-2 text-azure">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Analyzing document for Bill of Materials...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Bill of Materials Results */}
      {billOfMaterials.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Extracted Bill of Materials</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border">
                <thead>
                  <tr className="bg-muted">
                    <th className="border border-border p-3 text-left">Item</th>
                    <th className="border border-border p-3 text-left">Quantity</th>
                    <th className="border border-border p-3 text-left">Unit Price</th>
                    <th className="border border-border p-3 text-left">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {billOfMaterials.map((item, index) => (
                    <tr key={index} className="hover:bg-muted/50">
                      <td className="border border-border p-3">{item.item}</td>
                      <td className="border border-border p-3">{item.quantity}</td>
                      <td className="border border-border p-3">${item.unit_price.toFixed(2)}</td>
                      <td className="border border-border p-3 font-medium">
                        ${(item.quantity * item.unit_price).toFixed(2)}
                      </td>
                    </tr>
                  ))}
                </tbody>
                <tfoot>
                  <tr className="bg-muted font-medium">
                    <td className="border border-border p-3" colSpan={3}>Total</td>
                    <td className="border border-border p-3">
                      ${billOfMaterials.reduce((sum, item) => sum + (item.quantity * item.unit_price), 0).toFixed(2)}
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DocumentUpload;