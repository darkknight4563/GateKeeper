import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FileText, BarChart3, Users, TrendingUp } from "lucide-react";
import MultiFileUpload from './MultiFileUpload';
import VendorComparisonTable, { VendorData } from './VendorComparisonTable';

// Mock data for demonstration
const sampleVendors: VendorData[] = [
  {
    id: '1',
    vendorName: 'TechSupply Corp',
    quotedPrice: 12500,
    calculatedTCO: 14800,
    leadTime: 14,
    riskScore: 25,
    items: 45,
    currency: 'USD',
    riskFactors: ['Minor delivery delays in Q3', 'Single source supplier for 2 components'],
    tcoBreakdown: {
      quotedPrice: 12500,
      shippingCosts: 800,
      handlingFees: 300,
      riskPremium: 500,
      qualityAdjustment: 700
    }
  },
  {
    id: '2',
    vendorName: 'Global Electronics Ltd',
    quotedPrice: 11800,
    calculatedTCO: 16200,
    leadTime: 21,
    riskScore: 75,
    items: 42,
    currency: 'USD',
    riskFactors: [
      'History of late deliveries (30% of orders)',
      'Missing ISO 9001 certification',
      'Significant price discrepancy detected',
      'Located in high-risk geographic region'
    ],
    tcoBreakdown: {
      quotedPrice: 11800,
      shippingCosts: 1200,
      handlingFees: 400,
      riskPremium: 2300,
      qualityAdjustment: 500
    }
  },
  {
    id: '3',
    vendorName: 'Precision Manufacturing',
    quotedPrice: 13200,
    calculatedTCO: 15100,
    leadTime: 10,
    riskScore: 15,
    items: 48,
    currency: 'USD',
    riskFactors: ['Premium pricing for express delivery'],
    tcoBreakdown: {
      quotedPrice: 13200,
      shippingCosts: 600,
      handlingFees: 200,
      riskPremium: 200,
      qualityAdjustment: 900
    }
  },
  {
    id: '4',
    vendorName: 'Budget Components Inc',
    quotedPrice: 9500,
    calculatedTCO: 18500,
    leadTime: 35,
    riskScore: 85,
    items: 38,
    currency: 'USD',
    riskFactors: [
      'No quality certifications',
      'History of defective products (12% return rate)',
      'Extended lead times due to capacity issues',
      'Limited customer support availability'
    ],
    tcoBreakdown: {
      quotedPrice: 9500,
      shippingCosts: 2000,
      handlingFees: 800,
      riskPremium: 4500,
      qualityAdjustment: 1700
    }
  }
];

const VendorDashboard: React.FC = () => {
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<VendorData | null>(null);
  const [showResults, setShowResults] = useState(false);

  const handleFilesUploaded = (files: any[]) => {
    setUploadedFiles(files);
    // Simulate processing completion
    setTimeout(() => {
      setShowResults(true);
    }, 2000);
  };

  const handleProcessDocuments = () => {
    setShowResults(true);
  };

  const getDashboardStats = () => {
    const recommendedVendor = sampleVendors.reduce((prev, current) => 
      current.calculatedTCO < prev.calculatedTCO ? current : prev
    );
    
    const avgTCO = sampleVendors.reduce((sum, vendor) => sum + vendor.calculatedTCO, 0) / sampleVendors.length;
    const highRiskVendors = sampleVendors.filter(v => v.riskScore >= 70).length;
    
    return {
      totalVendors: sampleVendors.length,
      recommendedVendor: recommendedVendor.vendorName,
      avgTCO: avgTCO,
      highRiskCount: highRiskVendors,
      totalSavings: Math.max(...sampleVendors.map(v => v.calculatedTCO)) - recommendedVendor.calculatedTCO
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
              
              {uploadedFiles.length > 0 && !showResults && (
                <Button 
                  onClick={handleProcessDocuments}
                  className="w-full"
                  size="lg"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  Process & Compare Vendors
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Stats Overview */}
          {showResults && (
            <div className="grid grid-cols-1 gap-4">
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Total Vendors</p>
                      <p className="text-2xl font-bold text-foreground">{stats.totalVendors}</p>
                    </div>
                    <Users className="h-8 w-8 text-azure" />
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="text-sm text-muted-foreground">Recommended</p>
                      <p className="text-lg font-semibold text-success">{stats.recommendedVendor}</p>
                    </div>
                    <TrendingUp className="h-8 w-8 text-success" />
                  </div>
                </CardContent>
              </Card>
              
              <Card>
                <CardContent className="pt-6">
                  <div>
                    <p className="text-sm text-muted-foreground">Potential Savings</p>
                    <p className="text-xl font-bold text-success">
                      ${stats.totalSavings.toLocaleString()}
                    </p>
                    <div className="flex items-center gap-2 mt-2">
                      <Badge variant="outline" className="border-warning text-warning">
                        {stats.highRiskCount} High Risk
                      </Badge>
                    </div>
                  </div>
                </CardContent>
              </Card>
            </div>
          )}
        </div>

        {/* Right Panel - Results Display */}
        <div className="lg:col-span-2">
          {!showResults ? (
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
                vendors={sampleVendors}
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