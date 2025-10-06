import React, { useState, useMemo } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Separator } from "@/components/ui/separator";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { ArrowUpDown, Search, Eye, AlertTriangle, TrendingDown, Wrench, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

export interface VendorData {
  id: string;
  vendorName: string;
  quotedPrice: number;
  calculatedTCO: number;
  leadTime: number; // in days
  riskScore: number; // 0-100, higher is riskier
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
    // Fiber optic cable specs
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
    // Medical equipment specs
    manufacturer?: string;
    productionCountry?: string;
    documentComplexity?: string;
    // Generic fields
    [key: string]: any;
  };
  issues?: string[];
}

interface VendorComparisonTableProps {
  vendors: VendorData[];
  onVendorSelect?: (vendor: VendorData) => void;
}

type SortField = keyof Pick<VendorData, 'vendorName' | 'quotedPrice' | 'calculatedTCO' | 'leadTime' | 'riskScore'>;
type SortDirection = 'asc' | 'desc';

const VendorComparisonTable: React.FC<VendorComparisonTableProps> = ({ 
  vendors, 
  onVendorSelect 
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [sortField, setSortField] = useState<SortField>('calculatedTCO');
  const [sortDirection, setSortDirection] = useState<SortDirection>('asc');

  // Find the recommended vendor (lowest TCO)
  const recommendedVendor = useMemo(() => {
    return vendors.reduce((prev, current) => 
      current.calculatedTCO < prev.calculatedTCO ? current : prev
    );
  }, [vendors]);

  // Filter and sort vendors
  const filteredAndSortedVendors = useMemo(() => {
    let filtered = vendors.filter(vendor =>
      vendor.vendorName.toLowerCase().includes(searchTerm.toLowerCase())
    );

    filtered.sort((a, b) => {
      const aValue = a[sortField];
      const bValue = b[sortField];
      
      if (typeof aValue === 'string' && typeof bValue === 'string') {
        return sortDirection === 'asc' 
          ? aValue.localeCompare(bValue)
          : bValue.localeCompare(aValue);
      }
      
      return sortDirection === 'asc' 
        ? (aValue as number) - (bValue as number)
        : (bValue as number) - (aValue as number);
    });

    return filtered;
  }, [vendors, searchTerm, sortField, sortDirection]);

  const handleSort = (field: SortField) => {
    if (field === sortField) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const getRiskBadge = (riskScore: number) => {
    if (riskScore >= 70) return <Badge variant="destructive">High Risk</Badge>;
    if (riskScore >= 40) return <Badge className="bg-warning text-warning-foreground">Medium Risk</Badge>;
    return <Badge variant="outline" className="border-success text-success">Low Risk</Badge>;
  };

  const formatCurrency = (amount: number, currency: string = 'USD') => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: currency
    }).format(amount);
  };

  const VendorDetailModal = ({ vendor }: { vendor: VendorData }) => (
    <DialogContent className="max-w-2xl">
      <DialogHeader>
        <DialogTitle className="flex items-center gap-2">
          <Eye className="h-5 w-5" />
          {vendor.vendorName} - Detailed Analysis
          {vendor.issues && vendor.issues.length > 0 && (
            <Badge variant="destructive" className="ml-2">
              {vendor.issues.length} Issue{vendor.issues.length > 1 ? 's' : ''}
            </Badge>
          )}
        </DialogTitle>
      </DialogHeader>
      
      <div className="space-y-6">
        {/* Issues & Clarifications */}
        {vendor.issues && vendor.issues.length > 0 && (
          <Alert variant="destructive">
            <AlertCircle className="h-5 w-5" />
            <AlertDescription>
              <div className="font-bold mb-2">Issues & Clarifications Needed:</div>
              <ul className="space-y-1 text-sm">
                {vendor.issues.map((issue, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="mt-1">•</span>
                    <span>{issue}</span>
                  </li>
                ))}
              </ul>
            </AlertDescription>
          </Alert>
        )}
        
        {/* TCO Breakdown */}
        <div>
          <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <TrendingDown className="h-5 w-5 text-azure" />
            Total Cost of Ownership Breakdown
          </h4>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-3">
              <div className="flex justify-between p-3 bg-muted rounded-lg">
                <span>Quoted Price:</span>
                <span className="font-medium">{formatCurrency(vendor.tcoBreakdown.quotedPrice, vendor.currency)}</span>
              </div>
              <div className="flex justify-between p-3 bg-muted rounded-lg">
                <span>Shipping Costs:</span>
                <span className="font-medium">{formatCurrency(vendor.tcoBreakdown.shippingCosts, vendor.currency)}</span>
              </div>
              <div className="flex justify-between p-3 bg-muted rounded-lg">
                <span>Handling Fees:</span>
                <span className="font-medium">{formatCurrency(vendor.tcoBreakdown.handlingFees, vendor.currency)}</span>
              </div>
            </div>
            <div className="space-y-3">
              <div className="flex justify-between p-3 bg-muted rounded-lg">
                <span>Risk Premium:</span>
                <span className="font-medium text-warning">{formatCurrency(vendor.tcoBreakdown.riskPremium, vendor.currency)}</span>
              </div>
              <div className="flex justify-between p-3 bg-muted rounded-lg">
                <span>Quality Adjustment:</span>
                <span className="font-medium">{formatCurrency(vendor.tcoBreakdown.qualityAdjustment, vendor.currency)}</span>
              </div>
              <div className="flex justify-between p-3 bg-azure/10 border border-azure rounded-lg">
                <span className="font-semibold">Total TCO:</span>
                <span className="font-bold text-azure">{formatCurrency(vendor.calculatedTCO, vendor.currency)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Risk Factors */}
        <div>
          <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
            <AlertTriangle className="h-5 w-5 text-warning" />
            Risk Factors (Score: {vendor.riskScore}/100)
          </h4>
          <div className="space-y-2">
            {vendor.riskFactors.map((factor, index) => (
              <div key={index} className="flex items-center gap-2 p-2 bg-muted rounded">
                <AlertTriangle className="h-4 w-4 text-warning" />
                <span>{factor}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Technical Specifications */}
        {vendor.technicalSpecs && (
          <>
            <Separator />
            <div>
              <h4 className="text-lg font-semibold mb-4 flex items-center gap-2">
                <Wrench className="h-5 w-5 text-primary" />
                Technical Specifications (BOM Highlights)
              </h4>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-3">
                  {vendor.technicalSpecs.tubes && (
                    <div className="flex justify-between p-3 bg-muted rounded-lg">
                      <span className="text-muted-foreground">Tubes:</span>
                      <span className="font-medium">{vendor.technicalSpecs.tubes}</span>
                    </div>
                  )}
                  {vendor.technicalSpecs.fibers && (
                    <div className="flex justify-between p-3 bg-muted rounded-lg">
                      <span className="text-muted-foreground">Fibers:</span>
                      <span className="font-medium">{vendor.technicalSpecs.fibers}</span>
                    </div>
                  )}
                  {vendor.technicalSpecs.outerDiameter && (
                    <div className="flex justify-between p-3 bg-muted rounded-lg">
                      <span className="text-muted-foreground">Outer Diameter:</span>
                      <span className="font-medium">{vendor.technicalSpecs.outerDiameter}</span>
                    </div>
                  )}
                  {vendor.technicalSpecs.weight && (
                    <div className="flex justify-between p-3 bg-muted rounded-lg">
                      <span className="text-muted-foreground">Weight:</span>
                      <span className="font-medium">{vendor.technicalSpecs.weight}</span>
                    </div>
                  )}
                </div>
                <div className="space-y-3">
                  {vendor.technicalSpecs.bendRadius && (
                    <div className="flex justify-between p-3 bg-muted rounded-lg">
                      <span className="text-muted-foreground">Bend Radius:</span>
                      <span className="font-medium">{vendor.technicalSpecs.bendRadius}</span>
                    </div>
                  )}
                  {vendor.technicalSpecs.length && (
                    <div className="flex justify-between p-3 bg-muted rounded-lg">
                      <span className="text-muted-foreground">Length:</span>
                      <span className="font-medium">{vendor.technicalSpecs.length}</span>
                    </div>
                  )}
                  {vendor.technicalSpecs.specification && (
                    <div className="flex justify-between p-3 bg-muted rounded-lg">
                      <span className="text-muted-foreground">Specification:</span>
                      <span className="font-medium text-xs">{vendor.technicalSpecs.specification}</span>
                    </div>
                  )}
                  {vendor.technicalSpecs.certification && (
                    <div className="flex justify-between p-3 bg-muted rounded-lg">
                      <span className="text-muted-foreground">Certification:</span>
                      <span className="font-medium text-xs">{vendor.technicalSpecs.certification}</span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </>
        )}
      </div>
    </DialogContent>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center justify-between">
          <span>Vendor Comparison Report</span>
          <div className="flex items-center gap-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <Input
              placeholder="Search vendors..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-64"
            />
          </div>
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('vendorName')}
                    className="h-auto p-0 font-semibold"
                  >
                    Vendor Name
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('quotedPrice')}
                    className="h-auto p-0 font-semibold"
                  >
                    Quoted Price
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('calculatedTCO')}
                    className="h-auto p-0 font-semibold"
                  >
                    Calculated TCO
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('leadTime')}
                    className="h-auto p-0 font-semibold"
                  >
                    Lead Time
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>
                  <Button
                    variant="ghost"
                    onClick={() => handleSort('riskScore')}
                    className="h-auto p-0 font-semibold"
                  >
                    Risk Score
                    <ArrowUpDown className="ml-2 h-4 w-4" />
                  </Button>
                </TableHead>
                <TableHead>Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredAndSortedVendors.map((vendor) => {
                const isRecommended = vendor.id === recommendedVendor.id;
                const isHighRisk = vendor.riskScore >= 70;
                
                return (
                  <TableRow
                    key={vendor.id}
                    className={cn(
                      "cursor-pointer transition-colors",
                      isRecommended && "bg-success/10 hover:bg-success/15 border-l-4 border-l-success",
                      isHighRisk && !isRecommended && "bg-destructive/10 hover:bg-destructive/15 border-l-4 border-l-destructive",
                      !isRecommended && !isHighRisk && "hover:bg-muted/50"
                    )}
                    onClick={() => onVendorSelect?.(vendor)}
                  >
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className="font-medium">{vendor.vendorName}</span>
                        {isRecommended && (
                          <Badge className="bg-success text-white">
                            BEST
                          </Badge>
                        )}
                        {isHighRisk && (
                          <Badge variant="destructive">
                            HIGH RISK
                          </Badge>
                        )}
                        {vendor.issues && vendor.issues.length > 0 && (
                          <Badge variant="destructive" className="gap-1">
                            <AlertCircle className="h-3 w-3" />
                            {vendor.issues.length} ALERT{vendor.issues.length > 1 ? 'S' : ''}
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                    <TableCell>{formatCurrency(vendor.quotedPrice, vendor.currency)}</TableCell>
                    <TableCell>
                      <span className={cn(
                        "font-semibold",
                        isRecommended && "text-success"
                      )}>
                        {formatCurrency(vendor.calculatedTCO, vendor.currency)}
                      </span>
                    </TableCell>
                    <TableCell className={cn(
                      vendor.leadTime <= 14 && "text-success font-semibold",
                      vendor.leadTime > 28 && "text-warning"
                    )}>
                      {vendor.leadTime} days
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span className={cn(
                          "font-semibold",
                          isHighRisk && "text-destructive",
                          !isHighRisk && vendor.riskScore < 40 && "text-success"
                        )}>
                          {vendor.riskScore}
                        </span>
                        {getRiskBadge(vendor.riskScore)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Dialog>
                        <DialogTrigger asChild>
                          <Button variant="outline" size="sm">
                            <Eye className="h-4 w-4 mr-1" />
                            Details
                          </Button>
                        </DialogTrigger>
                        <VendorDetailModal vendor={vendor} />
                      </Dialog>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
        
        {filteredAndSortedVendors.length === 0 && (
          <div className="text-center py-8 text-muted-foreground">
            No vendors found matching your search criteria.
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default VendorComparisonTable;