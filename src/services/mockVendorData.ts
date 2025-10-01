import { VendorData } from './documentApi';

// Real data extracted from uploaded vendor offers
export const mockVendorOffers: VendorData[] = [
  {
    id: 'aker-001',
    vendorName: 'Aker Solutions',
    quotedPrice: 5400000,
    calculatedTCO: 5670000, // Base + shipping + handling + risk premium
    leadTime: 322, // 46 weeks = 322 days
    riskScore: 35,
    items: 2,
    currency: 'EUR',
    riskFactors: [
      '+15 points: Moderate schedule risk (46 weeks lead time)',
      '+10 points: Price variance €270k above base cost',
      '+5 points: Standard payment terms (no flexibility)',
      '+10 points: Multi-component delivery complexity',
      '-5 points: Proven supplier track record in region',
      '= 35 Total Risk Score'
    ],
    tcoBreakdown: {
      quotedPrice: 5400000,
      shippingCosts: 120000,
      handlingFees: 80000,
      riskPremium: 70000,
      qualityAdjustment: 0
    },
    technicalSpecs: {
      tubes: 18,
      fibers: 4,
      outerDiameter: '89mm',
      weight: '42 kg/km',
      bendRadius: '1.5m',
      length: '5000m continuous',
      specification: 'API 17J compliant',
      certification: 'DNV-GL certified'
    },
    issues: [
      'Minor payment term clarification needed for milestone 3'
    ]
  },
  {
    id: 'technip-001',
    vendorName: 'TechnipFMC',
    quotedPrice: 5100000,
    calculatedTCO: 5350000, // Best TCO
    leadTime: 294, // 42 weeks = 294 days (fastest)
    riskScore: 25,
    items: 2,
    currency: 'EUR',
    riskFactors: [
      '+5 points: Low schedule risk (42 weeks - fastest delivery)',
      '+8 points: Price variance €250k above base cost',
      '+5 points: Standard payment terms',
      '+12 points: Integrated delivery coordination required',
      '-5 points: Excellent ISO/API certification compliance',
      '-10 points: Premium quality track record',
      '+10 points: Single-source dependency',
      '= 25 Total Risk Score (LOWEST)'
    ],
    tcoBreakdown: {
      quotedPrice: 5100000,
      shippingCosts: 110000,
      handlingFees: 70000,
      riskPremium: 50000,
      qualityAdjustment: 20000
    },
    technicalSpecs: {
      tubes: 18,
      fibers: 4,
      outerDiameter: '85mm',
      weight: '38 kg/km',
      bendRadius: '1.3m',
      length: '5000m continuous',
      specification: 'API 17J + ISO 13628-5',
      certification: 'DNV-GL + Lloyd\'s Register'
    },
    issues: []
  },
  {
    id: 'onesubsea-001',
    vendorName: 'OneSubsea',
    quotedPrice: 5800000,
    calculatedTCO: 6150000, // Highest TCO
    leadTime: 378, // 54 weeks = 378 days (slowest)
    riskScore: 55,
    items: 2,
    currency: 'EUR',
    riskFactors: [
      '+25 points: High schedule risk (54 weeks - longest lead time)',
      '+15 points: Significant price variance (€350k above quoted)',
      '+10 points: Premium pricing (highest quoted price)',
      '+5 points: Complex multi-phase milestone structure',
      '+8 points: Extended payment terms increase exposure',
      '-8 points: Specialized subsea technology expertise',
      '= 55 Total Risk Score (MEDIUM RISK)'
    ],
    tcoBreakdown: {
      quotedPrice: 5800000,
      shippingCosts: 130000,
      handlingFees: 100000,
      riskPremium: 120000,
      qualityAdjustment: 0
    },
    technicalSpecs: {
      tubes: 24,
      fibers: 6,
      outerDiameter: '95mm',
      weight: '48 kg/km',
      bendRadius: '1.8m',
      length: '5000m in 2 sections',
      specification: 'API 17J compliant',
      certification: 'DNV-GL certified'
    },
    issues: [
      '⚠️ PRICE MISMATCH: Quoted €5.8M but calculated €5.91M (€110k difference)',
      '⚠️ Delivery split into 2 sections - coordination risk',
      'Clarification needed: Final payment terms for section 2 delivery',
      'Missing: Detailed warranty terms for multi-section delivery'
    ]
  }
];

// Mock processing response to match API format
export const getMockProcessingResults = () => {
  return {
    job_id: 'mock-job-' + Date.now(),
    status: 'completed',
    results: mockVendorOffers,
    summary: {
      totalVendors: mockVendorOffers.length,
      recommendedVendor: 'TechnipFMC',
      avgTCO: mockVendorOffers.reduce((sum, v) => sum + v.calculatedTCO, 0) / mockVendorOffers.length,
      highRiskCount: mockVendorOffers.filter(v => v.riskScore >= 70).length
    }
  };
};
