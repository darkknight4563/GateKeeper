import { useState, useCallback } from 'react';
import { Upload, FileText, CheckCircle, AlertCircle, Loader2, Download } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { documentApi, type DocumentUploadResponse, type VendorData } from '@/services/documentApi';
import { useToast } from '@/hooks/use-toast';
import { processFiles } from '@/services/ingest';

const DocumentUpload = () => {
  const [isUploading, setIsUploading] = useState(false);
  const [uploadedDoc, setUploadedDoc] = useState<DocumentUploadResponse | null>(null);
  const [vendorResults, setVendorResults] = useState<VendorData[]>([]);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [currentJobId, setCurrentJobId] = useState<string | null>(null);
  const [isGeneratingReport, setIsGeneratingReport] = useState(false);
  const { toast } = useToast();

  const handleFileUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Validation guards
    if (file.size === 0) {
      toast({
        title: "Empty file",
        description: "Please select a valid file",
        variant: "destructive"
      });
      return;
    }

    if (file.size > 50 * 1024 * 1024) {
      toast({
        title: "File too large",
        description: "File exceeds 50MB limit",
        variant: "destructive"
      });
      return;
    }

    setIsUploading(true);
    try {
      // Process document using new ingest service
      const results = await processFiles([file]);
      console.log("Ingest fragments:", results);
      
      // Upload to backend for further processing
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
      // Start document processing
      const processResult = await documentApi.processDocument(documentId);
      setCurrentJobId(processResult.job_id);
      
      toast({
        title: "Processing started",
        description: "Document is being analyzed for vendor data extraction",
      });
      
      // Poll for results with progress updates
      const results = await documentApi.pollJobStatus(
        processResult.job_id,
        (progress) => {
          console.log(`Processing progress: ${progress}%`);
        }
      );
      
      setVendorResults(results.results);
      
      toast({
        title: "Analysis complete",
        description: `Extracted data from ${results.results.length} vendor${results.results.length !== 1 ? 's' : ''}`,
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

  const handleGenerateReport = async () => {
    if (!currentJobId) return;
    
    setIsGeneratingReport(true);
    try {
      const reportData = await documentApi.generateReport(currentJobId);
      
      // Create and download HTML file
      const blob = new Blob([reportData.html], { type: 'text/html' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = reportData.filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);

      toast({
        title: "Report Generated",
        description: "Your comparison report has been downloaded.",
      });
    } catch (error) {
      console.error("Report generation error:", error);
      toast({
        title: "Error",
        description: error instanceof Error ? error.message : "Failed to generate report",
        variant: "destructive",
      });
    } finally {
      setIsGeneratingReport(false);
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
              accept=".pdf,.xlsx,.docx,.csv"
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
                  {isUploading ? 'Processing document...' : 'Upload Document'}
                </p>
                <p className="text-muted-foreground">
                  Click to select or drag and drop (PDF, Excel, Word, CSV)
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
              
              {uploadedDoc.status === 'completed' && !isAnalyzing && vendorResults.length === 0 && (
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
                  Analyzing document for vendor data extraction...
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {/* Vendor Analysis Results */}
      {vendorResults.length > 0 && (
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <CardTitle>Vendor Analysis Results</CardTitle>
              <Button 
                onClick={handleGenerateReport} 
                disabled={isGeneratingReport || !currentJobId}
                variant="outline"
                className="gap-2"
              >
                <Download className="h-4 w-4" />
                {isGeneratingReport ? "Generating..." : "Generate Report"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <table className="w-full border-collapse border border-border">
                <thead>
                  <tr className="bg-muted">
                    <th className="border border-border p-3 text-left">Vendor</th>
                    <th className="border border-border p-3 text-left">Quoted Price</th>
                    <th className="border border-border p-3 text-left">Calculated TCO</th>
                    <th className="border border-border p-3 text-left">Lead Time</th>
                    <th className="border border-border p-3 text-left">Risk Score</th>
                  </tr>
                </thead>
                <tbody>
                  {vendorResults.map((vendor) => (
                    <tr key={vendor.id} className="hover:bg-muted/50">
                      <td className="border border-border p-3 font-medium">{vendor.vendorName}</td>
                      <td className="border border-border p-3">${vendor.quotedPrice.toLocaleString()}</td>
                      <td className="border border-border p-3 font-semibold text-azure">
                        ${vendor.calculatedTCO.toLocaleString()}
                      </td>
                      <td className="border border-border p-3">{vendor.leadTime} days</td>
                      <td className="border border-border p-3">
                        <Badge 
                          variant={vendor.riskScore >= 70 ? "destructive" : vendor.riskScore >= 40 ? "secondary" : "outline"}
                          className={vendor.riskScore < 40 ? "border-success text-success" : ""}
                        >
                          {vendor.riskScore}/100
                        </Badge>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            
            {/* Risk Factors */}
            <div className="mt-4 space-y-2">
              <h4 className="font-medium">Risk Factors Summary:</h4>
              {vendorResults.map((vendor) => (
                vendor.riskFactors.length > 0 && (
                  <div key={vendor.id} className="p-3 bg-muted rounded-lg">
                    <p className="font-medium text-sm mb-1">{vendor.vendorName}:</p>
                    <ul className="list-disc list-inside text-sm text-muted-foreground space-y-1">
                      {vendor.riskFactors.map((factor, index) => (
                        <li key={index}>{factor}</li>
                      ))}
                    </ul>
                  </div>
                )
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
};

export default DocumentUpload;