import React, { useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { FileText, BarChart3, Trophy, AlertTriangle, TrendingDown, Download } from "lucide-react";
import { toast } from "sonner";
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { BarChart, Bar, RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer } from 'recharts';
import MultiFileUpload from './MultiFileUpload';
import VendorComparisonTable, { VendorData } from './VendorComparisonTable';
import { processFiles } from '@/services/ingest';
import { getMockProcessingResults } from '@/services/mockVendorData';

const VendorDashboard: React.FC = () => {
  const [uploadedFiles, setUploadedFiles] = useState<any[]>([]);
  const [selectedVendor, setSelectedVendor] = useState<VendorData | null>(null);
  const [vendorResults, setVendorResults] = useState<VendorData[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiInsightSummary, setAiInsightSummary] = useState<string>('');

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

      console.log('Processing', files.length, 'files using AI extraction...');
      
      // Import supabase client
      const { supabase } = await import('@/integrations/supabase/client');

      // Ensure user is authenticated (required for RLS)
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        toast.error('Please sign in to process documents');
        setIsProcessing(false);
        return;
      }
      const currentUser = userData.user;
      
      // Process each file through the full pipeline
      const processedDocs = await Promise.all(files.map(async (file) => {
        try {
          console.log(`Processing ${file.name}...`);
          
          // 1. Upload to storage
          const filePath = `${currentUser.id}/${crypto.randomUUID()}_${file.name}`;
          const { error: uploadError } = await supabase.storage
            .from('procurement-documents')
            .upload(filePath, file);
          
          if (uploadError) {
            console.error('Upload error:', uploadError);
            throw uploadError;
          }
          
          // 2. Create document record
          const { data: docData, error: docError } = await supabase
            .from('documents')
            .insert({
              filename: file.name,
              file_path: filePath,
              mime_type: file.type,
              file_size: file.size,
              upload_status: 'pending',
              user_id: currentUser.id,
            })
            .select()
            .single();
          
          if (docError || !docData) {
            console.error('Document creation error:', docError);
            throw docError;
          }
          
          // 3. Convert file to base64 for processing
          const arrayBuffer = await file.arrayBuffer();
          const bytes = new Uint8Array(arrayBuffer);
          let binary = "";
          const chunkSize = 0x8000;
          for (let i = 0; i < bytes.length; i += chunkSize) {
            binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
          }
          const base64 = btoa(binary);
          
          // 4. Call document-processor edge function for AI extraction
          const { data: processorResult, error: processorError } = await supabase.functions.invoke(
            'document-processor',
            {
              body: {
                document_id: docData.id,
                file_content: base64,
                filename: file.name,
                mime_type: file.type
              }
            }
          );
          
          if (processorError) {
            console.error('Processor error:', processorError);
            throw processorError;
          }
          
          console.log(`Processed ${file.name}:`, processorResult);
          return {
            file,
            docData,
            extracted: processorResult
          };
        } catch (error) {
          console.error(`Failed to process ${file.name}:`, error);
          toast.error(`Failed to process ${file.name}`);
          return null;
        }
      }));
      
      // Filter out failed processings
      const validDocs = processedDocs.filter(doc => doc !== null);
      
      if (validDocs.length === 0) {
        toast.error('Failed to process any documents');
        return;
      }
      
      console.log('Valid processed docs:', validDocs);
      
      // Convert extracted data to VendorData format
      const candidateVendors = validDocs.map((doc: any) => {
        const extracted = doc.extracted;
        const file = doc.file;
        
        console.log(`Processing extracted data for ${file.name}:`, extracted);
        
        // Support both new and legacy shapes
        const vd = extracted?.vendor_data ?? extracted;
        if (!vd || typeof vd !== 'object') {
          console.warn(`No extracted data for ${file.name}`);
          return {
            fileName: file.name,
            supplier: 'Unknown',
            currency: 'EUR',
            quotedPrice: 0,
            leadDays: 280,
            manufacturer: '',
            productionCountry: '',
            fragmentsCount: 0,
            technicalSpecs: null,
            issues: ['Failed to extract data from document']
          };
        }
        
        // Extract fields
        const supplier = vd.vendor_name || vd.supplier || file.name.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
        const currency = vd.currency || 'EUR';
        const quotedPriceRaw = vd.quoted_price ?? vd.quoted_total ?? 0;
        const quotedPrice = typeof quotedPriceRaw === 'string' ? Number(quotedPriceRaw.replace(/[^0-9.]/g, '')) : Number(quotedPriceRaw) || 0;
        
        // Lead time (weeks -> days)
        const leadWeeks = vd.quoted_lead_time ?? vd.terms?.delivery_weeks ?? null;
        const leadDays = leadWeeks ? Number(leadWeeks) * 7 : 280;
        
        // Technical specs
        const technicalSpecs = vd.technical_specs || null;
        
        // Issues/clarifications
        const issues: string[] = [];
        if (Array.isArray(vd.issues)) issues.push(...vd.issues);
        if (Array.isArray(vd.clarifications)) issues.push(...vd.clarifications.map((c: string) => `[Data Gap] ${c}`));
        if (!quotedPrice) issues.push('No quoted price found in document');
        
        return {
          fileName: file.name,
          supplier,
          currency,
          quotedPrice,
          leadDays,
          manufacturer: technicalSpecs?.manufacturer || '',
          productionCountry: technicalSpecs?.production_country || '',
          fragmentsCount: vd.items_count ?? vd.items?.length ?? 0,
          technicalSpecs,
          issues: issues.length > 0 ? issues : undefined,
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
        const vendorName = v.supplier || v.fileName.replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ');
        const price = v.quotedPrice || 0;
        const ship = Math.round(price * 0.02);
        const handling = Math.round(price * 0.015);
        const riskPremium = Math.round(price * (0.01 + norm(v.leadDays, minL, maxL) * 0.02));
        const qualityAdjustment = 0;
        const calculatedTCO = Math.round(price + ship + handling + riskPremium + qualityAdjustment);
        
        // Calculate detailed risk score with factor breakdown
        const priceNormFactor = norm(price, minP, maxP);
        const leadNormFactor = norm(v.leadDays, minL, maxL);
        
        // Schedule risk (0-30 points based on lead time)
        const scheduleRiskPoints = Math.round(leadNormFactor * 30);
        const scheduleRiskDesc = leadNormFactor > 0.7 ? 'High schedule risk' 
          : leadNormFactor > 0.4 ? 'Moderate schedule risk' 
          : 'Low schedule risk';
        
        // Price risk (0-40 points based on price variance)
        const priceRiskPoints = Math.round(priceNormFactor * 40);
        const priceVarianceAmount = price - minP;
        const priceVarianceFormatted = new Intl.NumberFormat('en-US', {
          style: 'currency',
          currency: v.currency,
          minimumFractionDigits: 0,
          maximumFractionDigits: 0,
        }).format(priceVarianceAmount);
        const priceRiskDesc = priceVarianceAmount > 0 
          ? `Price variance ${priceVarianceFormatted} above base cost`
          : 'Competitive pricing';
        
        // Delivery complexity (0-15 points)
        const complexityPoints = v.fragmentsCount > 5 ? 15 : v.fragmentsCount > 3 ? 10 : 5;
        
        // Quality adjustment (-10 to 0 points)
        const qualityPoints = -5; // Assume standard quality for all
        
        const totalRiskScore = Math.min(95, Math.max(5, scheduleRiskPoints + priceRiskPoints + complexityPoints + qualityPoints));
        
        // Build detailed risk factor breakdown
        const riskFactors: string[] = [];
        if (scheduleRiskPoints > 0) {
          riskFactors.push(`+${scheduleRiskPoints} points: ${scheduleRiskDesc} (${Math.round(v.leadDays / 7)} weeks lead time)`);
        }
        if (priceRiskPoints > 0) {
          riskFactors.push(`+${priceRiskPoints} points: ${priceRiskDesc}`);
        }
        if (complexityPoints > 0) {
          riskFactors.push(`+${complexityPoints} points: ${v.fragmentsCount > 5 ? 'Complex multi-section document' : 'Standard document structure'}`);
        }
        if (qualityPoints < 0) {
          riskFactors.push(`${qualityPoints} points: Standard quality expectations`);
        }
        riskFactors.push(`= ${totalRiskScore} Total Risk Score`);

        // Build technical specs from extracted data
        const technicalSpecs: any = {};
        
        // If we have technical specs from AI extraction, use them
        if (v.technicalSpecs) {
          Object.assign(technicalSpecs, v.technicalSpecs);
        }
        
        // Add additional metadata
        if (v.manufacturer) technicalSpecs.manufacturer = v.manufacturer;
        if (v.productionCountry) technicalSpecs.productionCountry = v.productionCountry;
        if (v.fragmentsCount) technicalSpecs.documentComplexity = `${v.fragmentsCount} line items`;

        // Combine issues from extraction and validation
        const issues: string[] = [...(v.issues || [])];
        if (!price) issues.push('No clear total price detected in the document');
        if (v.fragmentsCount === 0) issues.push('No extractable content was found');

        return {
          id: `vendor-${i}`,
          vendorName,
          quotedPrice: price,
          calculatedTCO,
          leadTime: v.leadDays,
          riskScore: totalRiskScore,
          items: v.fragmentsCount || 1,
          currency: v.currency,
          riskFactors,
          tcoBreakdown: {
            quotedPrice: price,
            shippingCosts: ship,
            handlingFees: handling,
            riskPremium,
            qualityAdjustment,
          },
          technicalSpecs: Object.keys(technicalSpecs).length > 0 ? technicalSpecs : undefined,
          issues: issues.length > 0 ? issues : undefined,
        } as VendorData;
      });

      if (!vendors.length) {
        toast.error('No usable data extracted from the uploaded files');
        return;
      }

      setVendorResults(vendors);
      setSelectedVendor(null);
      
      // Generate AI insight summary
      generateAIInsight(vendors);
      
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
      
      // Generate AI insight summary for demo data
      generateAIInsight(mockResults.results);
      
      toast.success(`Loaded ${mockResults.results.length} demo vendor offers`);
    } catch (error) {
      console.error('Demo data load error:', error);
      toast.error('Failed to load demo data');
    } finally {
      setIsProcessing(false);
    }
  };

  const generateAIInsight = async (vendors: VendorData[]) => {
    if (!vendors || vendors.length === 0) return;
    
    try {
      const recommendedVendor = vendors.reduce((prev, current) => 
        current.calculatedTCO < prev.calculatedTCO ? current : prev
      );
      
      const avgTCO = vendors.reduce((sum, vendor) => sum + vendor.calculatedTCO, 0) / vendors.length;
      const highRiskCount = vendors.filter(v => v.riskScore >= 70).length;
      const worstVendor = vendors.reduce((prev, current) => 
        current.calculatedTCO > prev.calculatedTCO ? current : prev
      );
      const totalSavings = worstVendor.calculatedTCO - recommendedVendor.calculatedTCO;
      const currency = vendors[0]?.currency || 'EUR';

      const response = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-insight-summary`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY}`,
          },
          body: JSON.stringify({
            winner: recommendedVendor.vendorName,
            avgTCO: Math.round(avgTCO),
            highRiskCount,
            totalVendors: vendors.length,
            totalSavings,
            currency,
          }),
        }
      );

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429) {
          toast.error('AI rate limit reached. Please try again later.');
        } else if (response.status === 402) {
          toast.error('AI credits required. Please add funds to continue.');
        } else {
          console.error('AI summary error:', errorData);
        }
        setAiInsightSummary('Analysis complete. Review the detailed vendor comparison below.');
        return;
      }

      const data = await response.json();
      setAiInsightSummary(data.summary || 'Analysis complete. Review the detailed vendor comparison below.');
    } catch (error) {
      console.error('Failed to generate AI insight:', error);
      setAiInsightSummary('Analysis complete. Review the detailed vendor comparison below.');
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
    
    // AI Insight Summary (if available)
    let currentY = 35;
    if (aiInsightSummary) {
      doc.setFontSize(14);
      doc.setTextColor(41, 128, 185); // Blue color
      doc.text('AI Insight Summary', 14, currentY);
      currentY += 8;
      
      doc.setFontSize(10);
      doc.setTextColor(60, 60, 60);
      const maxWidth = doc.internal.pageSize.width - 28;
      const summaryLines = doc.splitTextToSize(aiInsightSummary, maxWidth);
      summaryLines.forEach((line: string) => {
        doc.text(line, 14, currentY);
        currentY += 5;
      });
      currentY += 5;
    }
    
    // Winner Recommendation
    if (stats) {
      const winner = vendorResults.find(v => v.vendorName === stats.recommendedVendor);
      const currency = winner?.currency || 'EUR';
      
      doc.setFontSize(12);
      doc.setTextColor(0, 128, 0);
      doc.text(`Winner: ${stats.recommendedVendor}`, 14, currentY);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(10);
      currentY += 7;
      doc.text(`TCO: ${formatCurrency(stats.recommendedTCO, currency)} | Lead Time: ${stats.recommendedLeadTime} days`, 14, currentY);
      currentY += 6;
      doc.text(`Saves ${formatCurrency(stats.totalSavings, currency)} vs worst option`, 14, currentY);
      currentY += 10;
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
      startY: currentY,
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
      let finalY = (doc as any).lastAutoTable.finalY + 10;
      doc.setFontSize(11);
      doc.text('Summary Statistics:', 14, finalY);
      doc.setFontSize(10);
      finalY += 7;
      doc.text(`Total Vendors Analyzed: ${stats.totalVendors}`, 14, finalY);
      finalY += 7;
      doc.text(`Average TCO: ${formatCurrency(Math.round(stats.avgTCO), currency)}`, 14, finalY);
      finalY += 7;
      doc.text(`High Risk Vendors: ${stats.highRiskCount}`, 14, finalY);
      
      // TCO Comparison Chart (text representation)
      finalY += 15;
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('TCO Comparison Chart:', 14, finalY);
      finalY += 8;
      doc.setFontSize(9);
      
      // Sort vendors by TCO for chart
      const sortedByTCO = [...vendorResults].sort((a, b) => a.calculatedTCO - b.calculatedTCO);
      const maxTCO = Math.max(...vendorResults.map(v => v.calculatedTCO));
      
      sortedByTCO.forEach((vendor) => {
        if (finalY > doc.internal.pageSize.height - 30) {
          doc.addPage();
          finalY = 20;
        }
        
        const barWidth = (vendor.calculatedTCO / maxTCO) * 150;
        doc.setTextColor(60, 60, 60);
        doc.text(vendor.vendorName.substring(0, 25), 14, finalY);
        
        // Draw bar
        doc.setFillColor(41, 128, 185);
        doc.rect(90, finalY - 3, barWidth, 4, 'F');
        
        // Value
        doc.text(formatCurrency(vendor.calculatedTCO, vendor.currency), 245, finalY);
        finalY += 8;
      });
      
      // Risk Score Comparison
      finalY += 10;
      if (finalY > doc.internal.pageSize.height - 80) {
        doc.addPage();
        finalY = 20;
      }
      
      doc.setFontSize(12);
      doc.setTextColor(0, 0, 0);
      doc.text('Risk Score Comparison:', 14, finalY);
      finalY += 8;
      doc.setFontSize(9);
      
      // Sort vendors by risk score for chart
      const sortedByRisk = [...vendorResults].sort((a, b) => b.riskScore - a.riskScore);
      const maxRisk = 100;
      
      sortedByRisk.forEach((vendor) => {
        if (finalY > doc.internal.pageSize.height - 30) {
          doc.addPage();
          finalY = 20;
        }
        
        const barWidth = (vendor.riskScore / maxRisk) * 150;
        doc.setTextColor(60, 60, 60);
        doc.text(vendor.vendorName.substring(0, 25), 14, finalY);
        
        // Draw bar with color based on risk level
        if (vendor.riskScore >= 70) {
          doc.setFillColor(220, 38, 38); // Red
        } else if (vendor.riskScore >= 40) {
          doc.setFillColor(234, 179, 8); // Yellow
        } else {
          doc.setFillColor(34, 197, 94); // Green
        }
        doc.rect(90, finalY - 3, barWidth, 4, 'F');
        
        // Value
        doc.text(`${vendor.riskScore}/100`, 245, finalY);
        finalY += 8;
      });
      
      // Data Gaps & Alerts Section (if available)
      if (uploadedFiles.some(f => f.dataGaps?.length > 0 || f.alerts?.length > 0)) {
        finalY += 15;
        if (finalY > doc.internal.pageSize.height - 100) {
          doc.addPage();
          finalY = 20;
        }
        
        doc.setFontSize(14);
        doc.setTextColor(234, 179, 8); // Yellow/Warning color
        doc.text('Data Gaps & Alerts', 14, finalY);
        finalY += 10;
        doc.setFontSize(9);
        doc.setTextColor(60, 60, 60);
        
        uploadedFiles.forEach((file) => {
          if (file.dataGaps && file.dataGaps.length > 0) {
            if (finalY > doc.internal.pageSize.height - 50) {
              doc.addPage();
              finalY = 20;
            }
            
            doc.setFontSize(10);
            doc.setTextColor(0, 0, 0);
            doc.text(`${file.file.name}:`, 14, finalY);
            finalY += 6;
            doc.setFontSize(9);
            doc.setTextColor(60, 60, 60);
            
            file.dataGaps.forEach((gap: string) => {
              if (finalY > doc.internal.pageSize.height - 30) {
                doc.addPage();
                finalY = 20;
              }
              const bulletPoint = String.fromCharCode(8226);
              doc.text(`${bulletPoint} ${gap}`, 18, finalY);
              finalY += 5;
            });
            finalY += 3;
          }
          
          if (file.alerts && file.alerts.length > 0) {
            if (finalY > doc.internal.pageSize.height - 50) {
              doc.addPage();
              finalY = 20;
            }
            
            file.alerts.forEach((alert: string) => {
              if (finalY > doc.internal.pageSize.height - 30) {
                doc.addPage();
                finalY = 20;
              }
              const bulletPoint = String.fromCharCode(9888); // Warning symbol
              doc.setTextColor(234, 179, 8);
              doc.text(`${bulletPoint} ${alert}`, 18, finalY);
              doc.setTextColor(60, 60, 60);
              finalY += 5;
            });
            finalY += 3;
          }
        });
      }
      
      // Risk Analysis Section with detailed breakdown
      let riskY = finalY + 15;
      if (riskY > doc.internal.pageSize.height - 100) {
        doc.addPage();
        riskY = 20;
      }
      doc.setFontSize(14);
      doc.setTextColor(0, 0, 0);
      doc.text('Risk Score Analysis', 14, riskY);
      doc.setFontSize(9);
      
      vendorResults.forEach((vendor, index) => {
        riskY += 12;
        
        // Check if we need a new page
        if (riskY > doc.internal.pageSize.height - 80) {
          doc.addPage();
          riskY = 20;
        }
        
        // Vendor header with name and risk score
        doc.setFontSize(12);
        doc.setTextColor(0, 0, 0);
        doc.text(`${vendor.vendorName}`, 14, riskY);
        
        riskY += 6;
        doc.setFontSize(10);
        doc.text(`Risk Score: ${vendor.riskScore}/100`, 14, riskY);
        
        riskY += 6;
        
        // Price normalization factor (calculate from TCO components)
        const priceVariance = vendor.quotedPrice > 0 
          ? ((vendor.quotedPrice - vendorResults[0].quotedPrice) / vendorResults[0].quotedPrice) * 100 
          : 0;
        doc.setFontSize(9);
        doc.text(`Price normalization factor: ${priceVariance.toFixed(0)}%`, 14, riskY);
        
        riskY += 5;
        doc.text(`Lead time: ${vendor.leadTime} days`, 14, riskY);
        
        riskY += 8;
        
        // Show detailed risk factors if available
        if (vendor.riskFactors && vendor.riskFactors.length > 0) {
          vendor.riskFactors.forEach((factor) => {
            if (riskY > doc.internal.pageSize.height - 30) {
              doc.addPage();
              riskY = 20;
            }
            
            // Color code based on factor type
            if (factor.startsWith('+')) {
              doc.setTextColor(200, 0, 0); // Red for risk-increasing factors
            } else if (factor.startsWith('-')) {
              doc.setTextColor(0, 150, 0); // Green for risk-reducing factors
            } else if (factor.startsWith('=')) {
              doc.setFontSize(10);
              doc.setTextColor(0, 0, 0); // Black for total
            }
            
            doc.text(`  ${factor}`, 18, riskY);
            riskY += 5;
            doc.setFontSize(9);
          });
        }
        
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
      
      // Technical Specifications Section - Dynamic table based on available fields
      if (vendorResults.some(v => v.technicalSpecs)) {
        riskY += 15;
        
        // Check if we need a new page
        if (riskY > doc.internal.pageSize.height - 100) {
          doc.addPage();
          riskY = 20;
        }
        
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text('Technical Specifications', 14, riskY);
        riskY += 8;
        
        // Determine which fields are available across all vendors
        const allFields = new Set<string>();
        vendorResults.forEach(v => {
          if (v.technicalSpecs) {
            Object.keys(v.technicalSpecs).forEach(key => allFields.add(key));
          }
        });
        
        // Check if we have fiber optic specs or medical equipment specs
        const hasFiberSpecs = allFields.has('tubes') || allFields.has('fibers');
        const hasMedicalSpecs = allFields.has('manufacturer') || allFields.has('productionCountry');
        
        if (hasFiberSpecs) {
          // Original fiber optic cable format
          const techSpecsData = vendorResults
            .filter(v => v.technicalSpecs)
            .map(vendor => {
              const specs = vendor.technicalSpecs!;
              return [
                vendor.vendorName.substring(0, 20),
                specs.tubes !== undefined ? String(specs.tubes) : '-',
                specs.fibers !== undefined ? String(specs.fibers) : '-',
                specs.outerDiameter || '-',
                specs.weight || '-',
                specs.bendRadius || '-',
                specs.length || '-',
                specs.specification || '-',
                specs.certification || '-'
              ];
            });
          
          autoTable(doc, {
            startY: riskY,
            head: [['Company', 'Tubes', 'Fibers', 'OD', 'Weight', 'Bend Radius', 'Length', 'Spec', 'Cert']],
            body: techSpecsData,
            headStyles: { fillColor: [100, 100, 100], fontSize: 8 },
            bodyStyles: { fontSize: 7 },
            margin: { left: 14, right: 14 }
          });
        } else if (hasMedicalSpecs) {
          // Medical equipment format
          const techSpecsData = vendorResults
            .filter(v => v.technicalSpecs)
            .map(vendor => {
              const specs = vendor.technicalSpecs!;
              return [
                vendor.vendorName.substring(0, 30),
                specs.manufacturer || '-',
                specs.productionCountry || '-',
                specs.documentComplexity || '-'
              ];
            });
          
          autoTable(doc, {
            startY: riskY,
            head: [['Vendor', 'Manufacturer', 'Production Country', 'Document Complexity']],
            body: techSpecsData,
            headStyles: { fillColor: [100, 100, 100], fontSize: 9 },
            bodyStyles: { fontSize: 8 },
            margin: { left: 14, right: 14 }
          });
        }
        
        riskY = (doc as any).lastAutoTable.finalY + 10;
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
              
              {/* Data Gaps & Alerts Counter */}
              {uploadedFiles.length > 0 && (uploadedFiles.some(f => f.dataGaps?.length > 0 || f.alerts?.length > 0)) && (
                <Alert className="bg-warning/10 border-warning">
                  <AlertTriangle className="h-4 w-4 text-warning" />
                  <AlertDescription>
                    <div className="space-y-2">
                      <div className="font-semibold text-warning">
                        {uploadedFiles.reduce((count, f) => count + (f.dataGaps?.length || 0), 0)} data gap(s), {' '}
                        {uploadedFiles.reduce((count, f) => count + (f.alerts?.length || 0), 0)} alert(s) detected
                      </div>
                      <div className="text-xs space-y-1">
                        {uploadedFiles.map((file, idx) => {
                          const gaps = file.dataGaps?.length || 0;
                          const alerts = file.alerts?.length || 0;
                          if (gaps === 0 && alerts === 0) return null;
                          
                          return (
                            <div key={idx} className="text-muted-foreground">
                              <span className="font-medium">{file.file?.name || `File ${idx + 1}`}:</span>
                              {gaps > 0 && <span className="ml-1">{gaps} gap{gaps > 1 ? 's' : ''}</span>}
                              {gaps > 0 && alerts > 0 && <span>, </span>}
                              {alerts > 0 && <span>{alerts} alert{alerts > 1 ? 's' : ''}</span>}
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  </AlertDescription>
                </Alert>
              )}
              
              {/* AI Insight Summary */}
              {aiInsightSummary && (
                <Card className="bg-gradient-to-r from-primary/5 to-azure/5 border-primary/20">
                  <CardContent className="pt-6">
                    <div className="flex items-start gap-3">
                      <div className="p-2 bg-primary/10 rounded-lg">
                        <BarChart3 className="h-5 w-5 text-primary" />
                      </div>
                      <div className="flex-1">
                        <h4 className="font-semibold text-foreground mb-2">AI Insight Summary</h4>
                        <p className="text-sm text-muted-foreground leading-relaxed">
                          {aiInsightSummary}
                        </p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
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
              {/* Charts Section */}
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                {/* TCO Comparison Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <BarChart3 className="h-5 w-5" />
                      TCO Comparison
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <BarChart data={vendorResults.map(v => ({
                        name: v.vendorName.length > 15 ? v.vendorName.substring(0, 15) + '...' : v.vendorName,
                        tco: v.calculatedTCO,
                        quotedPrice: v.quotedPrice
                      }))}>
                        <CartesianGrid strokeDasharray="3 3" />
                        <XAxis dataKey="name" angle={-45} textAnchor="end" height={80} />
                        <YAxis />
                        <Tooltip 
                          formatter={(value: number) => `$${value.toLocaleString()}`}
                          labelStyle={{ color: 'hsl(var(--foreground))' }}
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--background))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '6px'
                          }}
                        />
                        <Legend />
                        <Bar dataKey="quotedPrice" fill="hsl(var(--primary))" name="Quoted Price" />
                        <Bar dataKey="tco" fill="hsl(var(--azure))" name="Total TCO" />
                      </BarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>

                {/* Risk Score Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <AlertTriangle className="h-5 w-5" />
                      Risk Score Comparison
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <ResponsiveContainer width="100%" height={300}>
                      <RadarChart data={vendorResults.map(v => ({
                        vendor: v.vendorName.length > 12 ? v.vendorName.substring(0, 12) + '...' : v.vendorName,
                        riskScore: v.riskScore,
                      }))}>
                        <PolarGrid />
                        <PolarAngleAxis dataKey="vendor" />
                        <PolarRadiusAxis angle={90} domain={[0, 100]} />
                        <Radar 
                          name="Risk Score" 
                          dataKey="riskScore" 
                          stroke="hsl(var(--destructive))" 
                          fill="hsl(var(--destructive))" 
                          fillOpacity={0.6} 
                        />
                        <Tooltip 
                          formatter={(value: number) => `${value}/100`}
                          labelStyle={{ color: 'hsl(var(--foreground))' }}
                          contentStyle={{ 
                            backgroundColor: 'hsl(var(--background))',
                            border: '1px solid hsl(var(--border))',
                            borderRadius: '6px'
                          }}
                        />
                        <Legend />
                      </RadarChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </div>

              {/* Technical Specifications Section */}
              {vendorResults.some(v => v.technicalSpecs && Object.keys(v.technicalSpecs).length > 0) && (
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <FileText className="h-5 w-5" />
                      Technical Specifications
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="space-y-6">
                      {vendorResults.map((vendor, idx) => {
                        const specs = vendor.technicalSpecs;
                        if (!specs || Object.keys(specs).length === 0) return null;

                        return (
                          <div key={idx} className="border-b border-border pb-4 last:border-b-0 last:pb-0">
                            <h4 className="font-semibold text-foreground mb-3">{vendor.vendorName}</h4>
                            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                              {specs.tubes && (
                                <div className="bg-muted/50 p-3 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Tubes</p>
                                  <p className="font-semibold text-foreground">{specs.tubes}</p>
                                </div>
                              )}
                              {specs.fibers && (
                                <div className="bg-muted/50 p-3 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Fibers</p>
                                  <p className="font-semibold text-foreground">{specs.fibers}</p>
                                </div>
                              )}
                              {specs.outerDiameter && (
                                <div className="bg-muted/50 p-3 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Outer Diameter</p>
                                  <p className="font-semibold text-foreground">{specs.outerDiameter}</p>
                                </div>
                              )}
                              {specs.weight && (
                                <div className="bg-muted/50 p-3 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Weight</p>
                                  <p className="font-semibold text-foreground">{specs.weight}</p>
                                </div>
                              )}
                              {specs.bendRadius && (
                                <div className="bg-muted/50 p-3 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Bend Radius</p>
                                  <p className="font-semibold text-foreground">{specs.bendRadius}</p>
                                </div>
                              )}
                              {specs.length && (
                                <div className="bg-muted/50 p-3 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Length</p>
                                  <p className="font-semibold text-foreground">{specs.length}</p>
                                </div>
                              )}
                              {specs.specification && (
                                <div className="bg-muted/50 p-3 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Specification</p>
                                  <p className="font-semibold text-foreground">{specs.specification}</p>
                                </div>
                              )}
                              {specs.certification && (
                                <div className="bg-muted/50 p-3 rounded-lg">
                                  <p className="text-xs text-muted-foreground">Certification</p>
                                  <p className="font-semibold text-foreground">{specs.certification}</p>
                                </div>
                              )}
                            </div>
                            {(specs.standards && specs.standards.length > 0) && (
                              <div className="mt-3">
                                <p className="text-xs text-muted-foreground mb-1">Standards</p>
                                <div className="flex flex-wrap gap-2">
                                  {specs.standards.map((std: string, i: number) => (
                                    <span key={i} className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-md">
                                      {std}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                            {(specs.certifications && specs.certifications.length > 0) && (
                              <div className="mt-3">
                                <p className="text-xs text-muted-foreground mb-1">Certifications</p>
                                <div className="flex flex-wrap gap-2">
                                  {specs.certifications.map((cert: string, i: number) => (
                                    <span key={i} className="px-2 py-1 bg-success/10 text-success text-xs rounded-md">
                                      {cert}
                                    </span>
                                  ))}
                                </div>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Vendor Comparison Table */}
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