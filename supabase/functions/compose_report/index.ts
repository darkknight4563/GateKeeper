import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Helper to format currency
function formatCurrency(amount: number, currency: string, locale: string): string {
  try {
    return new Intl.NumberFormat(locale, {
      style: 'currency',
      currency: currency,
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(amount);
  } catch {
    return `${currency} ${amount.toLocaleString(locale)}`;
  }
}

// Helper to format percentage
function formatPercent(value: number, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: 'percent',
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(value / 100);
}

// Helper to determine risk level
function getRiskLevel(score: number): string {
  if (score >= 70) return "Critical";
  if (score >= 50) return "High";
  if (score >= 30) return "Medium";
  return "Low";
}

// Helper to get severity emoji
function getSeverityIcon(severity: string): string {
  switch (severity.toLowerCase()) {
    case 'high': return '🔴';
    case 'medium': return '🟡';
    case 'low': return '🟢';
    default: return '⚪';
  }
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { 
      documents, 
      scores, 
      issues, 
      bom, 
      currency_preference = 'USD',
      locale = 'en-US',
      currency_rates = {} // Optional: { NOK: 0.095, EUR: 1.12 } - conversion to USD
    } = await req.json();

    console.log('Compose report inputs:', { 
      documentsCount: documents?.length,
      scoresCount: scores?.length,
      issuesCount: issues?.length,
      bomCount: bom?.length,
      currency_preference,
      locale,
      currency_rates
    });

    // Validate inputs - check for missing stages
    const missingStages: string[] = [];
    if (!documents || documents.length === 0) missingStages.push('extract');
    if (!scores || scores.length === 0) missingStages.push('score');
    if (!issues || issues.length === 0) missingStages.push('issues');
    if (!bom || bom.length === 0) missingStages.push('bom');

    if (missingStages.length > 0) {
      return new Response(JSON.stringify({
        diagnostic: true,
        missing_stages: missingStages,
        message: `Cannot generate report. Missing required stages: ${missingStages.join(', ')}`,
        hint: `Please run the following commands first: ${missingStages.map(s => `/${s}`).join(', ')}`
      }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // CRITICAL VALIDATION: Block if extraction returned no usable fields
    const emptyDocuments = documents.filter((doc: any) => {
      const hasDelivery = doc.delivery_weeks || doc.terms?.delivery_weeks || doc.lead_time;
      const hasWarranty = doc.warranty_months || doc.terms?.warranty_months;
      const hasLineItems = Array.isArray(doc.line_items) && doc.line_items.length > 0;
      const hasItems = Array.isArray(doc.items) && doc.items.length > 0;
      
      return !hasDelivery && !hasWarranty && !hasLineItems && !hasItems;
    });

    if (emptyDocuments.length === documents.length) {
      const diagnosticDetails = documents.map((doc: any) => {
        const supplier = doc.supplier || doc.supplier_name || 'Unknown';
        const mime = doc.mime_type || doc.document_type || 'unknown';
        const source = doc.source || doc.terms?.source || '[Unknown]';
        return `  - ${supplier}: MIME=${mime}, Source=${source}, Items=${doc.items?.length || doc.line_items?.length || 0}`;
      }).join('\n');

      return new Response(JSON.stringify({
        diagnostic: true,
        blocked_reason: 'extraction_returned_no_usable_fields',
        message: `DIAGNOSTIC: extraction returned no usable fields; blocking compose.`,
        details: `ALL suppliers missing critical data (delivery_weeks, warranty_months, line_items):\n${diagnosticDetails}`,
        hint: `The extraction pipeline failed. Check /document-processor logs for parsing errors. Re-upload documents or verify file content is not empty.`
      }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // CRITICAL VALIDATION: Check for delivery_weeks and warranty_months
    const dataGaps: { field: string; suppliers: { supplier: string; mime: string; source: string }[] }[] = [];
    
    const missingDelivery = documents.filter((doc: any) => {
      const deliveryWeeks = doc.delivery_weeks || doc.terms?.delivery_weeks || doc.lead_time;
      return deliveryWeeks === null || deliveryWeeks === undefined;
    }).map((doc: any) => ({
      supplier: doc.supplier || doc.supplier_name,
      mime: doc.mime_type || doc.document_type || 'unknown',
      source: doc.source || doc.terms?.source || '[Unknown]'
    }));

    const missingWarranty = documents.filter((doc: any) => {
      const warrantyMonths = doc.warranty_months || doc.terms?.warranty_months;
      return warrantyMonths === null || warrantyMonths === undefined;
    }).map((doc: any) => ({
      supplier: doc.supplier || doc.supplier_name,
      mime: doc.mime_type || doc.document_type || 'unknown',
      source: doc.source || doc.terms?.source || '[Unknown]'
    }));

    if (missingDelivery.length > 0) {
      dataGaps.push({ field: 'delivery_weeks', suppliers: missingDelivery });
    }
    if (missingWarranty.length > 0) {
      dataGaps.push({ field: 'warranty_months', suppliers: missingWarranty });
    }

    // Block report if ALL suppliers are missing critical fields
    if (missingDelivery.length === documents.length || missingWarranty.length === documents.length) {
      const diagnosticMessage = dataGaps.map(gap => {
        const supplierDetails = gap.suppliers.map(s => 
          `  - ${s.supplier}: MIME=${s.mime}, Source=${s.source}`
        ).join('\n');
        return `**${gap.field}** missing for ALL suppliers:\n${supplierDetails}`;
      }).join('\n\n');

      return new Response(JSON.stringify({
        diagnostic: true,
        blocked_reason: 'critical_data_missing',
        message: `DIAGNOSTIC: Cannot generate report. Critical fields missing from all suppliers.`,
        details: diagnosticMessage,
        data_gaps: dataGaps,
        hint: `Re-upload documents with delivery times and warranty information, or add this data manually in the document metadata.`
      }), {
        status: 422,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Check for mixed currencies without conversion rates
    const currencies = new Set(documents.map((d: any) => d.currency || d.totals?.currency || currency_preference));
    const hasMixedCurrencies = currencies.size > 1;
    
    if (hasMixedCurrencies) {
      const missingRates: string[] = [];
      const currenciesArray = Array.from(currencies) as string[];
      
      currenciesArray.forEach((curr: string) => {
        if (curr !== currency_preference && !currency_rates[curr]) {
          missingRates.push(curr);
        }
      });

      if (missingRates.length > 0) {
        const currencyList = currenciesArray.join(', ');
        const today = new Date().toISOString().split('T')[0];
        
        return new Response(JSON.stringify({
          diagnostic: true,
          blocked_reason: 'mixed_currency_without_rates',
          message: `Refusing to compute mixed-currency TCO without ECB rate ${today}.`,
          details: `Detected currencies: ${currencyList}\nMissing conversion rates for: ${missingRates.join(', ')}`,
          currencies_detected: currenciesArray,
          missing_rates: missingRates,
          hint: `Provide currency_rates object with conversion rates to ${currency_preference}. Example: {"NOK": 0.095, "EUR": 1.12}`
        }), {
          status: 422,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        });
      }
    }

    // Build vendor comparison data with currency conversion
    const vendors = documents.map((doc: any) => {
      const vendorScore = scores.find((s: any) => s.supplier === doc.supplier || s.supplier === doc.supplier_name);
      const vendorIssues = issues.filter((i: any) => i.supplier === doc.supplier || i.supplier === doc.supplier_name);
      const vendorBom = bom.find((b: any) => b.supplier === doc.supplier || b.supplier === doc.supplier_name);

      // Extract pricing data
      const originalCurrency = doc.currency || doc.totals?.currency || currency_preference;
      const quotedPrice = doc.quoted_price || doc.totals?.quoted_price || 0;
      const tco = doc.tco || quotedPrice;
      
      // Convert to preferred currency if needed
      let convertedTco = tco;
      let conversionRate = 1.0;
      let conversionNote = '';
      
      if (originalCurrency !== currency_preference && currency_rates[originalCurrency]) {
        conversionRate = currency_rates[originalCurrency];
        convertedTco = tco * conversionRate;
        conversionNote = `Converted from ${originalCurrency} at rate ${conversionRate}`;
      } else if (originalCurrency !== currency_preference) {
        conversionNote = `⚠️ No conversion rate provided for ${originalCurrency}`;
      }

      // Extract lead time with source
      const leadTime = doc.delivery_weeks || doc.terms?.delivery_weeks || doc.lead_time || null;
      const leadTimeSource = doc.terms?.source || doc.source || '[Unknown]';

      return {
        supplier: doc.supplier || doc.supplier_name,
        quoted_price: quotedPrice,
        tco: convertedTco,
        original_tco: tco,
        currency: currency_preference,
        original_currency: originalCurrency,
        conversion_rate: conversionRate,
        conversion_note: conversionNote,
        lead_time: leadTime,
        lead_time_source: leadTimeSource,
        risk_score: vendorScore?.risk_score || 0,
        risk_level: getRiskLevel(vendorScore?.risk_score || 0),
        risk_factors: vendorScore?.factors || [],
        risk_weights: vendorScore?.weights || {},
        risk_explanation: vendorScore?.explanation || '[Data Gap: No risk analysis generated]',
        what_lowers_risk: vendorScore?.what_lowers_risk || '[Data Gap: No recommendations generated]',
        issues: vendorIssues,
        bom: vendorBom,
        source: doc.source || '[Unknown]'
      };
    });

    // Sort vendors by TCO (ascending)
    vendors.sort((a: any, b: any) => a.tco - b.tco);

    const winner = vendors[0];
    const worst = vendors[vendors.length - 1];
    const savings = worst.tco - winner.tco;
    const savingsPercent = (savings / worst.tco) * 100;

    // Calculate summary statistics
    const avgTCO = vendors.reduce((sum: number, v: any) => sum + v.tco, 0) / vendors.length;
    const highRiskCount = vendors.filter((v: any) => v.risk_score >= 50).length;
    const criticalIssuesCount = issues.filter((i: any) => i.severity === 'High').length;

    // Generate timestamp
    const timestamp = new Date().toISOString();

    // Build currency conversion note
    const currencyConversionSection = vendors.some((v: any) => v.conversion_note && v.original_currency !== currency_preference)
      ? `\n### Currency Conversions\n\n${vendors
          .filter((v: any) => v.original_currency !== currency_preference)
          .map((v: any) => `- **${v.supplier}**: ${v.original_currency} → ${currency_preference} at rate ${v.conversion_rate.toFixed(4)} ${v.conversion_note ? `(${v.conversion_note})` : ''}`)
          .join('\n')}\n`
      : '';

    // Build Markdown report
    const markdown = `# Vendor Comparison Report

${currencyConversionSection}

## 🏆 Recommended Supplier

**${winner.supplier}**

- **Total Cost of Ownership:** ${formatCurrency(winner.tco, winner.currency, locale)} {${winner.source}}${winner.conversion_note ? ` *(${winner.conversion_note})*` : ''}
- **Lead Time:** ${winner.lead_time ? `${winner.lead_time} weeks {${winner.lead_time_source}}` : '[Data Gap: Lead time not specified]'}
- **Risk Score:** ${winner.risk_score}/100 (${winner.risk_level})
- **Savings vs. Highest:** ${formatCurrency(savings, winner.currency, locale)} (${formatPercent(savingsPercent, locale)})

---

## 📊 Vendor Comparison Table

| Supplier | Quoted Price | TCO | Lead Time | Risk Score | Risk Level |
|----------|-------------|-----|-----------|------------|------------|
${vendors.map((v: any) => {
  const tcoDisplay = v.original_currency !== currency_preference 
    ? `${formatCurrency(v.tco, v.currency, locale)}*` 
    : formatCurrency(v.tco, v.currency, locale);
  const leadDisplay = v.lead_time 
    ? `${v.lead_time}w {${v.lead_time_source}}` 
    : '[Data Gap]';
  return `| ${v.supplier} | ${formatCurrency(v.quoted_price, v.original_currency, locale)} | ${tcoDisplay} | ${leadDisplay} | ${v.risk_score}/100 | ${v.risk_level} |`;
}).join('\n')}

${vendors.some((v: any) => v.original_currency !== currency_preference) ? `\n*Converted to ${currency_preference}` : ''}

---

## 🎯 Risk Score Analysis

${vendors.map((v: any) => {
  const hasFactors = v.risk_factors && v.risk_factors.length > 0;
  const totalWeight = hasFactors ? v.risk_factors.reduce((sum: number, f: any) => sum + (f.weight || 0), 0) : 0;
  const weightedScore = hasFactors ? v.risk_factors.reduce((sum: number, f: any) => {
    const subscore = f.subscore !== null && f.subscore !== undefined ? f.subscore : 5;
    return sum + (f.weight || 0) * subscore;
  }, 0) : 0;
  
  return `### ${v.supplier} - Risk Score: ${v.risk_score}/100 (${v.risk_level})

**Analysis:** ${v.risk_explanation}

**Risk Reduction:** ${v.what_lowers_risk}

**Factor Breakdown:**${!hasFactors ? '\n[Data Gap: No risk factors computed]' : ''}
${hasFactors ? v.risk_factors.map((f: any) => {
  const subscore = f.subscore !== null && f.subscore !== undefined ? f.subscore : null;
  const sign = subscore !== null && subscore <= 3 ? '✅' : subscore !== null && subscore >= 7 ? '⚠️' : '•';
  const scoreDisplay = subscore !== null ? `${subscore.toFixed(1)}/10` : 'N/A';
  const weightPct = ((f.weight || 0) * 100).toFixed(0);
  const contribution = subscore !== null ? ((f.weight || 0) * subscore * 10).toFixed(1) : 'N/A';
  return `${sign} **${f.factor}** (weight: ${weightPct}%, score: ${scoreDisplay}, contribution: ${contribution}/100)\n  - ${f.evidence || '[Data Gap: No evidence]'}`;
}).join('\n') : ''}

**Calculation:** Total weighted score = ${weightedScore.toFixed(1)}/10 × 10 = **${v.risk_score}/100**
`;
}).join('\n---\n\n')}

---

## ⚠️ Issues & Clarifications

${vendors.length === 0 ? '[Data Gap: No vendor data available]' : ''}
${vendors.map((v: any) => {
  if (!v.issues || v.issues.length === 0) {
    return `### ${v.supplier}\n\n✅ No critical issues identified.`;
  }
  
  // Group issues by severity
  const highIssues = v.issues.filter((i: any) => i.severity === 'High');
  const mediumIssues = v.issues.filter((i: any) => i.severity === 'Medium');
  const lowIssues = v.issues.filter((i: any) => i.severity === 'Low');
  
  return `### ${v.supplier}

**Summary:** ${highIssues.length} High | ${mediumIssues.length} Medium | ${lowIssues.length} Low

${v.issues.map((issue: any) => 
  `${getSeverityIcon(issue.severity)} **${issue.title}** (${issue.severity})
- **Detail:** ${issue.detail}
- **Source:** ${issue.source}
- **Suggested Question:** *"${issue.suggested_question}"*`
).join('\n\n')}`;
}).join('\n\n---\n\n')}

---

## 🔧 Technical Specifications (BOM)

${vendors.length === 0 || vendors.every((v: any) => !v.bom || !v.bom.specs) ? '[Data Gap: No BOM data extracted. Run /bom first.]' : ''}

${vendors.some((v: any) => v.bom && v.bom.specs) ? `
| Supplier | Tubes | Fibers | Outer Diameter | Weight | Bend Radius | Length | Standards | Certifications |
|----------|-------|--------|----------------|--------|-------------|--------|-----------|----------------|
${vendors.map((v: any) => {
  const specs = v.bom?.specs || {};
  const sources = v.bom?.sources || {};
  
  const tubesCell = specs.tubes !== null && specs.tubes !== undefined 
    ? `${specs.tubes}${sources.tubes ? ` {${sources.tubes}}` : ''}` 
    : '[Gap]';
  const fibersCell = specs.fibers !== null && specs.fibers !== undefined 
    ? `${specs.fibers}${sources.fibers ? ` {${sources.fibers}}` : ''}` 
    : '[Gap]';
  const odCell = specs.outer_diameter 
    ? `${specs.outer_diameter}${sources.outer_diameter ? ` {${sources.outer_diameter}}` : ''}` 
    : '[Gap]';
  const weightCell = specs.weight 
    ? `${specs.weight}${sources.weight ? ` {${sources.weight}}` : ''}` 
    : '[Gap]';
  const bendCell = specs.bend_radius 
    ? `${specs.bend_radius}${sources.bend_radius ? ` {${sources.bend_radius}}` : ''}` 
    : '[Gap]';
  const lengthCell = specs.length 
    ? `${specs.length}${sources.length ? ` {${sources.length}}` : ''}` 
    : '[Gap]';
  const standardsCell = specs.standards && specs.standards.length > 0 
    ? `${specs.standards.join(', ')}${sources.standards ? ` {${sources.standards}}` : ''}` 
    : '[Gap]';
  const certsCell = specs.certifications && specs.certifications.length > 0 
    ? `${specs.certifications.join(', ')}${sources.certifications ? ` {${sources.certifications}}` : ''}` 
    : '[Gap]';
  
  return `| ${v.supplier} | ${tubesCell} | ${fibersCell} | ${odCell} | ${weightCell} | ${bendCell} | ${lengthCell} | ${standardsCell} | ${certsCell} |`;
}).join('\n')}` : ''}

${vendors.some((v: any) => v.bom?.conflicts && Object.keys(v.bom.conflicts).length > 0) ? `
### ⚠️ Conflicting Data Detected

${vendors.filter((v: any) => v.bom?.conflicts && Object.keys(v.bom.conflicts).length > 0).map((v: any) => `**${v.supplier}:**
${Object.entries(v.bom.conflicts).map(([field, values]: [string, any]) => 
  `- **${field}**: ${Array.isArray(values) ? values.join(' vs ') : values}`
).join('\n')}`).join('\n\n')}

*Note: Conflicting values require clarification from supplier.*
` : ''}

---

## 📈 Summary Statistics

- **Total Vendors Analyzed:** ${vendors.length}
- **Average TCO:** ${formatCurrency(avgTCO, currency_preference, locale)}
- **Price Range:** ${formatCurrency(winner.tco, currency_preference, locale)} - ${formatCurrency(worst.tco, currency_preference, locale)}
- **High-Risk Vendors:** ${highRiskCount}
- **Critical Issues:** ${criticalIssuesCount}

---

*Report generated: ${new Date(timestamp).toLocaleString(locale)}*
`;

    // Build JSON payload
    const jsonPayload = {
      winner_banner: {
        supplier: winner.supplier,
        tco: winner.tco,
        currency: winner.currency,
        lead_time: winner.lead_time,
        risk_score: winner.risk_score,
        risk_level: winner.risk_level,
        savings: savings,
        savings_percent: savingsPercent,
        source: winner.source
      },
      vendor_table: vendors.map((v: any) => ({
        supplier: v.supplier,
        quoted_price: v.quoted_price,
        tco: v.tco,
        currency: v.currency,
        lead_time: v.lead_time,
        risk_score: v.risk_score,
        risk_level: v.risk_level
      })),
      score_analysis: vendors.map((v: any) => ({
        supplier: v.supplier,
        risk_score: v.risk_score,
        risk_level: v.risk_level,
        explanation: v.risk_explanation,
        what_lowers_risk: v.what_lowers_risk,
        factors: v.risk_factors
      })),
      issues_and_clarifications: vendors.map((v: any) => ({
        supplier: v.supplier,
        issues: v.issues
      })),
      technical_specifications: vendors.map((v: any) => ({
        supplier: v.supplier,
        specs: v.bom?.specs || {},
        sources: v.bom?.sources || {},
        conflicts: v.bom?.conflicts || null
      })),
      summary_statistics: {
        total_vendors: vendors.length,
        average_tco: avgTCO,
        price_range: {
          min: winner.tco,
          max: worst.tco,
          currency: currency_preference
        },
        high_risk_count: highRiskCount,
        critical_issues_count: criticalIssuesCount
      },
      metadata: {
        generated_at: timestamp,
        currency: currency_preference,
        locale: locale
      }
    };

    return new Response(JSON.stringify({
      markdown,
      json: jsonPayload,
      summary: {
        winner: winner.supplier,
        tco: winner.tco,
        savings: savings,
        vendors_count: vendors.length
      }
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in compose_report function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
