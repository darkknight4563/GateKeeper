import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, BarChart3, Trophy, AlertTriangle, TrendingDown } from "lucide-react";
import { toast } from "sonner";
import MultiFileUpload from './MultiFileUpload';
import VendorComparisonTable, { VendorData } from './VendorComparisonTable';
import { documentApi } from '@/services/documentApi';
import { getMockProcessingResults } from '@/services/mockVendorData';

const VendorDashboard: React.FC = () => {
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<VendorData | null>(null);
  const [vendorResults, setVendorResults] = useState<VendorData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);

  const handleFilesUploaded = (files: any[]) => {
    setUploadedFiles(files);
  };

  const handleProcessDocuments = async () => {
    setIsProcessing(true);

    try {
      toast.info('Processing vendor offers...');
      
      // Simulate processing delay for realism
      await new Promise(resolve => setTimeout(resolve, 1500));
      
      // Load mock data from real vendor offers
      const mockResults = getMockProcessingResults();
      
      setVendorResults(mockResults.results);
      toast.success(`Successfully processed ${mockResults.results.length} vendor offers`);
      
    } catch (error) {
      console.error('Processing error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to process documents');
    } finally {
      setIsProcessing(false);
    }
  };

  const getDashboardStats = () => {
    if (vendorResults.length === 0) {
      return null;
    }

    const recommendedVendor = vendorResults.reduce((prev, current) => 
      current.calculatedTCO < prev.calculatedTCO ? current : prev
    );
    
    const avgTCO = vendorResults.reduce((sum, vendor) => sum + vendor.calculatedTCO, 0) / vendorResults.length;
    const highRiskVendors = vendorResults.filter(v => v.riskScore >= 70).length;
    const worstVendor = vendorResults.reduce((prev, current) => 
      current.calculatedTCO > prev.calculatedTCO ? current : prev
    );
    
    return {
      totalVendors: vendorResults.length,
      recommendedVendor: recommendedVendor.vendorName,
      recommendedTCO: recommendedVendor.calculatedTCO,
      recommendedLeadTime: recommendedVendor.leadTime,
      avgTCO: avgTCO,
      highRiskCount: highRiskVendors,
      totalSavings: worstVendor.calculatedTCO - recommendedVendor.calculatedTCO
    };
  };

  const stats = getDashboardStats();

  return (
    <div className="min-h-screen bg-background">
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 h-full">
        {/* Left Panel - File Upload */}
        <div className="lg:col-span-1 space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <FileText className="h-5 w-5" />
                Document Processing
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <MultiFileUpload 
                onFilesUploaded={handleFilesUploaded}
                maxFiles={10}
                maxFileSize={50 * 1024 * 1024} // 50MB
              />
              
              <Button 
                onClick={handleProcessDocuments}
                className="w-full"
                size="lg"
                disabled={isProcessing}
              >
                <BarChart3 className="h-4 w-4 mr-2" />
                {isProcessing ? 'Processing...' : 'Load Demo Data (Aker, Technip, OneSubsea)'}
              </Button>
            </CardContent>
          </Card>

          {/* Recommendation Card */}
          {stats && (
            <Alert className="bg-success/10 border-success">
              <Trophy className="h-5 w-5 text-success" />
              <AlertDescription>
                <div className="font-bold text-success mb-2">Winner: {stats.recommendedVendor}</div>
                <div className="text-sm space-y-1">
                  <div>TCO: <span className="font-semibold">${stats.recommendedTCO.toLocaleString()}</span></div>
                  <div>Lead Time: <span className="font-semibold">{stats.recommendedLeadTime} days</span></div>
                  <div className="text-xs text-muted-foreground mt-2">
                    Saves ${stats.totalSavings.toLocaleString()} vs worst option
                  </div>
                </div>
              </AlertDescription>
            </Alert>
          )}

          {/* Stats Overview */}
          {stats && (
            <div className="grid grid-cols-1 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Avg TCO</p>
                      <p className="text-2xl font-bold text-foreground">
                        ${Math.round(stats.avgTCO).toLocaleString()}
                      </p>
                    </div>
                    <BarChart3 className="h-8 w-8 text-azure" />
                  </div>
                </CardContent>
              </Card>
              
              {stats.highRiskCount > 0 && (
                <Alert variant="destructive">
                  <AlertTriangle className="h-4 w-4" />
                  <AlertDescription>
                    <span className="font-semibold">{stats.highRiskCount}</span> high-risk vendor(s) detected
                  </AlertDescription>
                </Alert>
              )}
            </div>
          )}
        </div>

        {/* Right Panel - Results Display */}
        <div className="lg:col-span-2">
          {vendorResults.length === 0 ? (
            <Card className="h-full flex items-center justify-center">
              <CardContent className="text-center">
                <FileText className="h-16 w-16 text-muted-foreground mx-auto mb-4" />
                <h3 className="text-xl font-semibold text-foreground mb-2">
                  Upload Documents to Begin
                </h3>
                <p className="text-muted-foreground max-w-md">
                  Upload vendor proposals, quotes, and specifications to generate 
                  a comprehensive comparison report with TCO analysis and risk scoring.
                </p>
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-6">
              <VendorComparisonTable 
                vendors={vendorResults}
                onVendorSelect={setSelectedVendor}
              />
              
              {selectedVendor && (
                <Card>
                  <CardHeader>
                    <CardTitle>Selected Vendor: {selectedVendor.vendorName}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">Quoted Price</p>
                        <p className="text-xl font-bold text-foreground">
                          ${selectedVendor.quotedPrice.toLocaleString()}
                        </p>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">Total TCO</p>
                        <p className="text-xl font-bold text-azure">
                          ${selectedVendor.calculatedTCO.toLocaleString()}
                        </p>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">Lead Time</p>
                        <p className="text-xl font-bold text-foreground">
                          {selectedVendor.leadTime} days
                        </p>
                      </div>
                      <div className="text-center p-4 bg-muted rounded-lg">
                        <p className="text-sm text-muted-foreground">Risk Score</p>
                        <p className={`text-xl font-bold ${
                          selectedVendor.riskScore >= 70 ? 'text-destructive' : 
                          selectedVendor.riskScore >= 40 ? 'text-warning' : 'text-success'
                        }`}>
                          {selectedVendor.riskScore}/100
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default VendorDashboard;