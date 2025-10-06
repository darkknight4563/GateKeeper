import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, BarChart3, Trophy, AlertTriangle, TrendingDown, Download } from "lucide-react";
import { toast } from "sonner";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import MultiFileUpload from './MultiFileUpload';
import VendorComparisonTable, { VendorData } from './VendorComparisonTable';
import { processFiles } from '@/services/ingest';
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
    if (!uploadedFiles || uploadedFiles.length === 0) {
      toast.info('Please upload one or more files first');
      return;
    }

    setIsProcessing(true);
    try {
      // Extract File objects from uploaded items
      const files: File[] = uploadedFiles.map((item: any) => item?.file ?? item);

      // Process all files using ingest service
      const results: any[] = await processFiles(files);
      console.log('Ingest results:', results);

      // Heuristic mapping of extracted fragments -> VendorData (one vendor per file)
      const candidateVendors = files.map((file, idx) => {
        const result = results[idx] || {};
        const fragments: any[] = Array.isArray(result?.fragments) ? result.fragments : [];

        const texts: string[] = [];
        const nums: number[] = [];
        const currenciesSeen = new Set<string>();

        const pushNum = (n: any) => {
          if (typeof n === 'number' && isFinite(n)) nums.push(n);
          else if (typeof n === 'string') {
            const cleaned = n.replace(/[^0-9.,\-]/g, '');
            if (!cleaned) return;
            let val = cleaned;
            if (val.includes('.') && val.includes(',')) val = val.replace(/,/g, '');
            else if (val.includes(',') && !val.includes('.')) val = val.replace(/,/g, '');
            const parsed = parseFloat(val);
            if (!isNaN(parsed) && isFinite(parsed)) nums.push(parsed);
          }
        };

        for (const f of fragments) {
          if (f?.text) {
            const t = String(f.text);
            texts.push(t);
            if (/[€]/.test(t)) currenciesSeen.add('EUR');
            if (/\bUSD\b|\$/i.test(t)) currenciesSeen.add('USD');
            if (/\bNOK\b/i.test(t)) currenciesSeen.add('NOK');
            // extract obvious big numbers
            for (const m of t.matchAll(/[-+]?\d[\d.,]{3,}/g)) pushNum(m[0]);
          }
          if (Array.isArray(f?.table)) {
            for (const row of f.table as any[]) {
              for (const cell of row as any[]) pushNum(cell);
            }
          }
        }

        const currency = currenciesSeen.has('EUR') ? 'EUR' : currenciesSeen.has('NOK') ? 'NOK' : currenciesSeen.has('USD') ? 'USD' : 'EUR';
        const priceCandidates = nums.filter(n => Math.abs(n) >= 1000).sort((a,b)=>b-a);
        const quotedPrice = priceCandidates[0] ? Math.abs(priceCandidates[0]) : 0;

        // Lead time detection (weeks/days)
        let leadDays = 0;
        const bigText = texts.join(' \n ');
        const weeksMatch = bigText.match(/(\d{1,3})\s*(weeks|week|wks|wk)/i);
        const daysMatch = bigText.match(/(\d{1,3})\s*(days|day)/i);
        if (weeksMatch) leadDays = parseInt(weeksMatch[1], 10) * 7;
        else if (daysMatch) leadDays = parseInt(daysMatch[1], 10);
        if (!leadDays) leadDays = 280; // default 40 weeks if absent

        return {
          fileName: file.name,
          fragmentsCount: fragments.length,
          nums,
          currency,
          quotedPrice,
          leadDays,
        };
      });

      // Normalize across vendors for risk and TCO
      const prices = candidateVendors.map(v => v.quotedPrice || 0);
      const leads = candidateVendors.map(v => v.leadDays || 0);
      const minP = Math.min(...prices.filter(p=>p>0), Number.POSITIVE_INFINITY);
      const maxP = Math.max(...prices, 0);
      const minL = Math.min(...leads.filter(l=>l>0), Number.POSITIVE_INFINITY);
      const maxL = Math.max(...leads, 0);
      const norm = (v: number, min: number, max: number) => (max > min ? (v - min) / (max - min) : 0);

      const vendors: VendorData[] = candidateVendors.map((v, i) => {
        const vendorName = v.fileName.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
        const price = v.quotedPrice || 0;
        const ship = Math.round(price * 0.02);
        const handling = Math.round(price * 0.015);
        const riskPremium = Math.round(price * (0.01 + norm(v.leadDays, minL, maxL) * 0.02));
        const qualityAdjustment = 0;
        const calculatedTCO = Math.round(price + ship + handling + riskPremium + qualityAdjustment);
        const riskScore = Math.min(95, Math.max(5, Math.round(20 + norm(price, minP, maxP) * 50 + norm(v.leadDays, minL, maxL) * 30)));

        const issues: string[] = [];
        if (!price) issues.push('No clear total price detected in the document');
        if (v.fragmentsCount === 0) issues.push('No extractable content was found');

        return {
          id: `vendor-${i}`,
          vendorName,
          quotedPrice: price,
          calculatedTCO,
          leadTime: v.leadDays,
          riskScore,
          items: 1,
          currency: v.currency,
          riskFactors: [
            `Price normalization factor: ${(norm(price, minP, maxP) * 100).toFixed(0)}%`,
            `Lead time: ${v.leadDays} days`,
          ],
          tcoBreakdown: {
            quotedPrice: price,
            shippingCosts: ship,
            handlingFees: handling,
            riskPremium,
            qualityAdjustment,
          },
          issues,
        } as VendorData;
      });

      if (!vendors.length) {
        toast.error('No usable data extracted from the uploaded files');
        return;
      }

      setVendorResults(vendors);
      setSelectedVendor(null);
      toast.success(`Successfully processed ${files.length} document${files.length > 1 ? 's' : ''}`);
    } catch (error) {
      console.error('Processing error:', error);
      toast.error(error instanceof Error ? error.message : 'Failed to process documents');
    } finally {
      setIsProcessing(false);
    }
  };

  // Keep demo data loader as a separate action so it doesn't interfere with real processing
  const handleLoadDemoData = async () => {
    setIsProcessing(true);
    try {
      const mockResults = getMockProcessingResults();
      setVendorResults(mockResults.results);
      setSelectedVendor(null);
      toast.success(`Loaded ${mockResults.results.length} demo vendor offers`);
    } catch (error) {
      console.error('Demo data load error:', error);
      toast.error('Failed to load demo data');
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

  const handleGeneratePDF = () => {
    const doc = new jsPDF();
    
    // Helper to format currency consistently
    const formatCurrency = (amount: number, currency: string = 'EUR') => {
      return new Intl.NumberFormat('en-US', {
        style: 'currency',
        currency: currency
      }).format(amount);
    };
    
    // Title
    doc.setFontSize(20);
    doc.text('Vendor Comparison Report', 14, 20);
    
    // Winner Recommendation
    if (stats) {
      const winner = vendorResults.find(v => v.vendorName === stats.recommendedVendor);
      const currency = winner?.currency || 'EUR';
      
      doc.setFontSize(12);
      doc.setTextColor(0, 128, 0);
      doc.text(`Winner: ${stats.recommendedVendor}`, 14, 35);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      doc.text(`TCO: ${formatCurrency(stats.recommendedTCO, currency)} | Lead Time: ${stats.recommendedLeadTime} days`, 14, 42);
      doc.text(`Saves ${formatCurrency(stats.totalSavings, currency)} vs worst option`, 14, 48);
    }
    
    // Table data
    const tableData = vendorResults.map(vendor => [
      vendor.vendorName,
      formatCurrency(vendor.quotedPrice, vendor.currency),
      formatCurrency(vendor.calculatedTCO, vendor.currency),
      `${vendor.leadTime} days`,
      `${vendor.riskScore}/100`,
      vendor.riskScore >= 70 ? 'High' : vendor.riskScore >= 40 ? 'Medium' : 'Low'
    ]);
    
    // Generate table
    autoTable(doc, {
      startY: 55,
      head: [['Vendor', 'Quoted Price', 'Total TCO', 'Lead Time', 'Risk Score', 'Risk Level']],
      body: tableData,
      headStyles: { fillColor: [41, 128, 185] },
      alternateRowStyles: { fillColor: [240, 240, 240] },
      didParseCell: (data) => {
        // Highlight winner row
        if (data.section === 'body' && stats) {
          const vendor = vendorResults[data.row.index];
          if (vendor.vendorName === stats.recommendedVendor) {
            data.cell.styles.fillColor = [200, 255, 200];
            data.cell.styles.fontStyle = 'bold';
          }
          // Highlight high risk
          if (data.column.index === 5 && vendor.riskScore >= 70) {
            data.cell.styles.textColor = [255, 0, 0];
            data.cell.styles.fontStyle = 'bold';
          }
        }
      }
    });
    
    // Summary stats
    if (stats) {
      const currency = vendorResults[0]?.currency || 'EUR';
      const finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(11);
      doc.text('Summary Statistics:', 14, finalY);
      doc.setFontSize(10);
      doc.text(`Total Vendors Analyzed: ${stats.totalVendors}`, 14, finalY + 7);
      doc.text(`Average TCO: ${formatCurrency(Math.round(stats.avgTCO), currency)}`, 14, finalY + 14);
      doc.text(`High Risk Vendors: ${stats.highRiskCount}`, 14, finalY + 21);
      
      // Risk Analysis Section
      let riskY = finalY + 35;
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('Risk Score Analysis', 14, riskY);
      doc.setFontSize(9);
      
      vendorResults.forEach((vendor, index) => {
        riskY += 12;
        
        // Vendor name with risk score
        doc.setFontSize(11);
        doc.setTextColor(0, 0, 0);
        doc.text(`${vendor.vendorName} (Risk Score: ${vendor.riskScore}/100)`, 14, riskY);
        
        riskY += 6;
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        
        // Risk factors
        vendor.riskFactors.forEach((factor) => {
          if (riskY > doc.internal.pageSize.height - 30) {
            doc.addPage();
            riskY = 20;
          }
          
          // Color code based on factor type
          if (factor.startsWith('+')) {
            doc.setTextColor(200, 0, 0); // Red for negative factors
          } else if (factor.startsWith('-')) {
            doc.setTextColor(0, 150, 0); // Green for positive factors
          } else if (factor.startsWith('=')) {
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0); // Black for total
          }
          
          doc.text(`  ${factor}`, 18, riskY);
          riskY += 5;
          doc.setFontSize(9);
        });
        
        riskY += 5; // Space between vendors
      });
      
      // Issues & Clarifications Section
      const vendorsWithIssues = vendorResults.filter(v => v.issues && v.issues.length > 0);
      if (vendorsWithIssues.length > 0) {
        riskY += 15;
        
        // Check if we need a new page
        if (riskY > doc.internal.pageSize.height - 100) {
          doc.addPage();
          riskY = 20;
        }
        
        doc.setFontSize(14);
        doc.setTextColor(220, 38, 38); // Red color
        doc.text('ISSUES & CLARIFICATIONS NEEDED', 14, riskY);
        doc.setFontSize(9);
        doc.setTextColor(0, 0, 0);
        
        vendorsWithIssues.forEach((vendor) => {
          riskY += 12;
          
          // Check if we need a new page
          if (riskY > doc.internal.pageSize.height - 60) {
            doc.addPage();
            riskY = 20;
          }
          
          // Vendor name in red
          doc.setFontSize(11);
          doc.setTextColor(220, 38, 38);
          doc.text(`${vendor.vendorName} (${vendor.issues!.length} issue${vendor.issues!.length > 1 ? 's' : ''})`, 14, riskY);
          
          riskY += 6;
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 60);
          
          vendor.issues!.forEach((issue) => {
            if (riskY > doc.internal.pageSize.height - 30) {
              doc.addPage();
              riskY = 20;
            }
            
            // Wrap text if too long - use simple bullet point
            const maxWidth = doc.internal.pageSize.width - 30;
            const bulletPoint = String.fromCharCode(8226); // Unicode bullet point •
            const lines = doc.splitTextToSize(`${bulletPoint} ${issue}`, maxWidth);
            lines.forEach((line: string) => {
              doc.text(line, 18, riskY);
              riskY += 5;
            });
          });
          
          riskY += 3;
        });
      }
      
      // Technical Specifications Section
      if (vendorResults.some(v => v.technicalSpecs)) {
        riskY += 10;
        
        // Check if we need a new page
        if (riskY > doc.internal.pageSize.height - 100) {
          doc.addPage();
          riskY = 20;
        }
        
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text('Technical Specifications (BOM)', 14, riskY);
        doc.setFontSize(9);
        
        vendorResults.forEach((vendor) => {
          if (!vendor.technicalSpecs) return;
          
          riskY += 12;
          
          // Check if we need a new page
          if (riskY > doc.internal.pageSize.height - 60) {
            doc.addPage();
            riskY = 20;
          }
          
          // Vendor name
          doc.setFontSize(11);
          doc.setTextColor(0, 0, 0);
          doc.text(vendor.vendorName, 14, riskY);
          
          riskY += 6;
          doc.setFontSize(9);
          doc.setTextColor(60, 60, 60);
          
          const specs = vendor.technicalSpecs;
          const specLines = [
            specs.tubes && `Tubes: ${specs.tubes}`,
            specs.fibers && `Fibers: ${specs.fibers}`,
            specs.outerDiameter && `OD: ${specs.outerDiameter}`,
            specs.weight && `Weight: ${specs.weight}`,
            specs.bendRadius && `Bend Radius: ${specs.bendRadius}`,
            specs.length && `Length: ${specs.length}`,
            specs.specification && `Spec: ${specs.specification}`,
            specs.certification && `Cert: ${specs.certification}`
          ].filter(Boolean) as string[];
          
          specLines.forEach((line) => {
            if (riskY > doc.internal.pageSize.height - 30) {
              doc.addPage();
              riskY = 20;
            }
            doc.text(`  ${line}`, 18, riskY);
            riskY += 5;
          });
          
          riskY += 3;
        });
      }
    }

    
    // Footer
    doc.setFontSize(8);
    doc.setTextColor(128, 128, 128);
    doc.text(`Generated on ${new Date().toLocaleString()}`, 14, doc.internal.pageSize.height - 10);
    
    // Save
    doc.save(`Vendor_Comparison_Report_${new Date().toISOString().split('T')[0]}.pdf`);
    toast.success('PDF report generated successfully');
  };

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
              
              {uploadedFiles.length > 0 && (
                <Button 
                  onClick={handleProcessDocuments}
                  className="w-full"
                  size="lg"
                  disabled={isProcessing}
                  variant="default"
                >
                  <BarChart3 className="h-4 w-4 mr-2" />
                  {isProcessing ? 'Processing...' : `Process ${uploadedFiles.length} Document${uploadedFiles.length > 1 ? 's' : ''}`}
                </Button>
              )}
              
              <Button 
                onClick={handleLoadDemoData}
                className="w-full"
                size="lg"
                disabled={isProcessing}
                variant="outline"
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
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <CardTitle>Vendor Comparison</CardTitle>
                    <Button 
                      onClick={handleGeneratePDF}
                      variant="default"
                      className="gap-2"
                    >
                      <Download className="h-4 w-4" />
                      Generate PDF Report
                    </Button>
                  </div>
                </CardHeader>
                <CardContent>
                  <VendorComparisonTable 
                    vendors={vendorResults}
                    onVendorSelect={setSelectedVendor}
                  />
                </CardContent>
              </Card>
              
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