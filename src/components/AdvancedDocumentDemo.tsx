import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { 
  FileText, 
  Upload, 
  Brain, 
  Settings, 
  CheckCircle2, 
  AlertTriangle,
  Loader2,
  Code,
  Database
} from "lucide-react";
import { advancedDocumentApi, type OCRResult, type BOMExtractionResult, type NormalizationResult } from "@/services/advancedDocumentApi";
import { useToast } from "@/hooks/use-toast";

const AdvancedDocumentDemo = () => {
  const [isProcessing, setIsProcessing] = useState(false);
  const [ocrResult, setOcrResult] = useState<OCRResult | null>(null);
  const [bomResult, setBomResult] = useState<BOMExtractionResult | null>(null);
  const [normalizationResult, setNormalizationResult] = useState<NormalizationResult | null>(null);
  const [activeTab, setActiveTab] = useState("upload");
  const { toast } = useToast();

  const handleAdvancedProcessing = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsProcessing(true);
    setOcrResult(null);
    setBomResult(null);
    setNormalizationResult(null);

    try {
      toast({
        title: "Starting advanced processing",
        description: "Running OCR, BOM extraction, and data normalization...",
      });

      // Run complete processing pipeline
      const results = await advancedDocumentApi.processDocumentComplete(file, {
        extractBOM: true,
        normalizeData: true,
        normalizationOptions: {
          applySynonymMapping: true,
          standardizeUnits: true,
          validateDataTypes: true
        }
      });

      setOcrResult(results.ocr_result);
      setBomResult(results.bom_result);
      setNormalizationResult(results.normalization_result);
      setActiveTab("ocr");

      toast({
        title: "Processing complete",
        description: `Extracted ${results.ocr_result.line_items?.length || 0} items with advanced normalization`,
      });
    } catch (error) {
      toast({
        title: "Processing failed",
        description: error instanceof Error ? error.message : "An error occurred",
        variant: "destructive"
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const demonstrateNormalization = () => {
    const examples = advancedDocumentApi.demonstrateNormalizationTechniques();
    setNormalizationResult({
      original: "Demo data before normalization",
      normalized: "Demo data after normalization",
      normalization_report: {
        changes: Object.entries(examples.examples).map(([key, example]) => ({
          path: key,
          from: example.before,
          to: example.after,
          type: example.description
        })),
        warnings: [],
        statistics: {}
      },
      techniques_applied: {
        removeWhitespace: true,
        applySynonymMapping: true,
        standardizeUnits: true,
        validateDataTypes: true
      },
      message: "Demonstration of normalization techniques"
    });
    setActiveTab("normalization");
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Brain className="h-5 w-5" />
            Advanced Document Processing Engine
          </CardTitle>
          <p className="text-muted-foreground">
            Demonstrates Python-equivalent OCR, Bill of Materials extraction, and data normalization
          </p>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <FileText className="h-8 w-8 text-azure" />
              <div>
                <p className="font-medium">OCR Simulation</p>
                <p className="text-sm text-muted-foreground">Text extraction with confidence scoring</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Database className="h-8 w-8 text-success" />
              <div>
                <p className="font-medium">BOM Extraction</p>
                <p className="text-sm text-muted-foreground">Identify line items from tables</p>
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 bg-muted rounded-lg">
              <Settings className="h-8 w-8 text-warning" />
              <div>
                <p className="font-medium">Data Normalization</p>
                <p className="text-sm text-muted-foreground">Clean and standardize extracted data</p>
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <input
                type="file"
                accept=".pdf,.xlsx,.csv"
                onChange={handleAdvancedProcessing}
                disabled={isProcessing}
                className="hidden"
                id="advanced-upload"
              />
              <Button 
                className="w-full" 
                size="lg"
                disabled={isProcessing}
                onClick={() => document.getElementById('advanced-upload')?.click()}
                asChild={false}
              >
                {isProcessing ? (
                  <>
                    <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                    Processing...
                  </>
                ) : (
                  <>
                    <Upload className="h-4 w-4 mr-2" />
                    Upload & Process Document
                  </>
                )}
              </Button>
            </div>
            
            <Button 
              onClick={demonstrateNormalization}
              variant="outline"
              size="lg"
            >
              <Code className="h-4 w-4 mr-2" />
              Demo Normalization
            </Button>
          </div>
        </CardContent>
      </Card>

      {/* Results */}
      {(ocrResult || bomResult || normalizationResult) && (
        <Card>
          <CardHeader>
            <CardTitle>Processing Results</CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={activeTab} onValueChange={setActiveTab}>
              <TabsList className="grid grid-cols-4 w-full">
                <TabsTrigger value="upload">Upload</TabsTrigger>
                <TabsTrigger value="ocr" disabled={!ocrResult}>
                  OCR Results
                  {ocrResult && <CheckCircle2 className="h-3 w-3 ml-1 text-success" />}
                </TabsTrigger>
                <TabsTrigger value="bom" disabled={!bomResult}>
                  BOM Extraction
                  {bomResult && <CheckCircle2 className="h-3 w-3 ml-1 text-success" />}
                </TabsTrigger>
                <TabsTrigger value="normalization" disabled={!normalizationResult}>
                  Normalization
                  {normalizationResult && <CheckCircle2 className="h-3 w-3 ml-1 text-success" />}
                </TabsTrigger>
              </TabsList>

              <TabsContent value="upload" className="mt-6">
                <div className="text-center py-8">
                  <Upload className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
                  <p className="text-lg font-medium mb-2">Ready for Processing</p>
                  <p className="text-muted-foreground">
                    Upload a document to see the advanced processing pipeline in action
                  </p>
                </div>
              </TabsContent>

              <TabsContent value="ocr" className="mt-6">
                {ocrResult && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">OCR Results</h3>
                      <Badge variant="outline" className="border-azure text-azure">
                        Confidence: {Math.round(ocrResult.confidence * 100)}%
                      </Badge>
                    </div>
                    
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                      <div>
                        <h4 className="font-medium mb-2">Extracted Text Preview</h4>
                        <div className="p-3 bg-muted rounded-lg max-h-40 overflow-y-auto">
                          <pre className="text-sm whitespace-pre-wrap">
                            {ocrResult.extracted_text.substring(0, 300)}
                            {ocrResult.extracted_text.length > 300 && '...'}
                          </pre>
                        </div>
                      </div>
                      
                      <div>
                        <h4 className="font-medium mb-2">Processing Info</h4>
                        <div className="space-y-2 text-sm">
                          <div className="flex justify-between">
                            <span>Line Items Found:</span>
                            <Badge>{ocrResult.line_items?.length || 0}</Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Text Normalization:</span>
                            <Badge variant={ocrResult.normalization_applied.text_normalization ? "default" : "secondary"}>
                              {ocrResult.normalization_applied.text_normalization ? "Applied" : "Skipped"}
                            </Badge>
                          </div>
                          <div className="flex justify-between">
                            <span>Synonym Mapping:</span>
                            <Badge variant={ocrResult.normalization_applied.synonym_mapping ? "default" : "secondary"}>
                              {ocrResult.normalization_applied.synonym_mapping ? "Applied" : "Skipped"}
                            </Badge>
                          </div>
                        </div>
                      </div>
                    </div>

                    {ocrResult.line_items && ocrResult.line_items.length > 0 && (
                      <div>
                        <h4 className="font-medium mb-2">Extracted Line Items</h4>
                        <div className="overflow-x-auto">
                          <table className="w-full border-collapse border border-border">
                            <thead>
                              <tr className="bg-muted">
                                <th className="border border-border p-2 text-left">Item</th>
                                <th className="border border-border p-2 text-left">Part Number</th>
                                <th className="border border-border p-2 text-left">Quantity</th>
                                <th className="border border-border p-2 text-left">Unit Price</th>
                                <th className="border border-border p-2 text-left">Category</th>
                              </tr>
                            </thead>
                            <tbody>
                              {ocrResult.line_items.slice(0, 5).map((item, index) => (
                                <tr key={index}>
                                  <td className="border border-border p-2">{item.item}</td>
                                  <td className="border border-border p-2">{item.part_number || 'N/A'}</td>
                                  <td className="border border-border p-2">{item.quantity}</td>
                                  <td className="border border-border p-2">${item.unit_price.toFixed(2)}</td>
                                  <td className="border border-border p-2">
                                    <Badge variant="outline">{item.category || 'other'}</Badge>
                                  </td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          {ocrResult.line_items.length > 5 && (
                            <p className="text-sm text-muted-foreground mt-2">
                              Showing 5 of {ocrResult.line_items.length} items
                            </p>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>

              <TabsContent value="bom" className="mt-6">
                {bomResult && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Bill of Materials Extraction</h3>
                      <Badge variant="outline" className="border-success text-success">
                        {bomResult.extraction_method}
                      </Badge>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-3 bg-muted rounded-lg">
                        <p className="text-2xl font-bold text-foreground">{bomResult.summary.total_items}</p>
                        <p className="text-sm text-muted-foreground">Total Items</p>
                      </div>
                      <div className="text-center p-3 bg-muted rounded-lg">
                        <p className="text-2xl font-bold text-foreground">{bomResult.summary.total_quantity}</p>
                        <p className="text-sm text-muted-foreground">Total Quantity</p>
                      </div>
                      <div className="text-center p-3 bg-muted rounded-lg">
                        <p className="text-2xl font-bold text-foreground">${bomResult.summary.total_value.toFixed(2)}</p>
                        <p className="text-sm text-muted-foreground">Total Value</p>
                      </div>
                      <div className="text-center p-3 bg-muted rounded-lg">
                        <p className="text-2xl font-bold text-foreground">{Object.keys(bomResult.summary.categories).length}</p>
                        <p className="text-sm text-muted-foreground">Categories</p>
                      </div>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">Category Breakdown</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(bomResult.summary.categories).map(([category, count]) => (
                          <Badge key={category} variant="outline">
                            {category.replace('_', ' ')}: {count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="normalization" className="mt-6">
                {normalizationResult && (
                  <div className="space-y-4">
                    <div className="flex items-center justify-between">
                      <h3 className="text-lg font-semibold">Data Normalization</h3>
                      <Badge variant="outline" className="border-warning text-warning">
                        {normalizationResult.normalization_report.changes.length} Changes Applied
                      </Badge>
                    </div>

                    <div>
                      <h4 className="font-medium mb-2">Applied Techniques</h4>
                      <div className="flex flex-wrap gap-2">
                        {Object.entries(normalizationResult.techniques_applied).map(([technique, applied]) => (
                          <Badge 
                            key={technique} 
                            variant={applied ? "default" : "secondary"}
                          >
                            {technique.replace(/([A-Z])/g, ' $1').trim()}
                          </Badge>
                        ))}
                      </div>
                    </div>

                    <Separator />

                    <div>
                      <h4 className="font-medium mb-2">Normalization Examples</h4>
                      <div className="space-y-3">
                        {normalizationResult.normalization_report.changes.slice(0, 8).map((change, index) => (
                          <div key={index} className="p-3 border rounded-lg">
                            <div className="flex items-center gap-2 mb-2">
                              <Badge variant="outline" className="text-xs">
                                {change.type}
                              </Badge>
                              <span className="text-sm font-medium">{change.path}</span>
                            </div>
                            <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-sm">
                              <div>
                                <span className="text-muted-foreground">Before:</span>
                                <code className="block bg-muted p-2 rounded mt-1">{change.from}</code>
                              </div>
                              <div>
                                <span className="text-muted-foreground">After:</span>
                                <code className="block bg-muted p-2 rounded mt-1">{change.to}</code>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    </div>

                    {normalizationResult.validation_summary && (
                      <div>
                        <h4 className="font-medium mb-2">Validation Summary</h4>
                        <div className="grid grid-cols-3 gap-4">
                          <div className="text-center p-3 bg-muted rounded-lg">
                            <p className="text-xl font-bold text-success">
                              {normalizationResult.validation_summary.valid_items}
                            </p>
                            <p className="text-sm text-muted-foreground">Valid Items</p>
                          </div>
                          <div className="text-center p-3 bg-muted rounded-lg">
                            <p className="text-xl font-bold text-destructive">
                              {normalizationResult.validation_summary.invalid_items}
                            </p>
                            <p className="text-sm text-muted-foreground">Invalid Items</p>
                          </div>
                          <div className="text-center p-3 bg-muted rounded-lg">
                            <p className="text-xl font-bold text-warning">
                              {normalizationResult.validation_summary.warnings.length}
                            </p>
                            <p className="text-sm text-muted-foreground">Warnings</p>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </TabsContent>
            </Tabs>
          </CardContent>
        </Card>
      )}

      {/* Technical Information */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Code className="h-5 w-5" />
            Implementation Details
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <FileText className="h-4 w-4" />
                OCR Processing
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Simulated text extraction from files</li>
                <li>• Confidence scoring and validation</li>
                <li>• Table structure recognition</li>
                <li>• Multi-format support (PDF, Excel, CSV)</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Database className="h-4 w-4" />
                BOM Extraction
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Pattern matching for line items</li>
                <li>• Multiple table format support</li>
                <li>• Data validation and categorization</li>
                <li>• Duplicate detection and removal</li>
              </ul>
            </div>
            
            <div>
              <h4 className="font-medium mb-2 flex items-center gap-2">
                <Settings className="h-4 w-4" />
                Normalization
              </h4>
              <ul className="text-sm text-muted-foreground space-y-1">
                <li>• Whitespace and case normalization</li>
                <li>• Synonym mapping and standardization</li>
                <li>• Unit conversion and validation</li>
                <li>• Price and quantity validation</li>
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default AdvancedDocumentDemo;