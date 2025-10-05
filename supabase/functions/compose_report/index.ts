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
      locale = 'en-US' 
    } = await req.json();

    console.log('Compose report inputs:', { 
      documentsCount: documents?.length,
      scoresCount: scores?.length,
      issuesCount: issues?.length,
      bomCount: bom?.length,
      currency_preference,
      locale
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

    // Build vendor comparison data
    const vendors = documents.map((doc: any) => {
      const vendorScore = scores.find((s: any) => s.supplier === doc.supplier);
      const vendorIssues = issues.filter((i: any) => i.supplier === doc.supplier);
      const vendorBom = bom.find((b: any) => b.supplier === doc.supplier);

      return {
        supplier: doc.supplier,
        quoted_price: doc.quoted_price || 0,
        tco: doc.tco || doc.quoted_price || 0,
        currency: doc.currency || currency_preference,
        lead_time: doc.delivery_weeks || doc.lead_time || null,
        risk_score: vendorScore?.risk_score || 0,
        risk_level: getRiskLevel(vendorScore?.risk_score || 0),
        risk_factors: vendorScore?.factors || [],
        risk_explanation: vendorScore?.explanation || '[Data Gap]',
        what_lowers_risk: vendorScore?.what_lowers_risk || '[Data Gap]',
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

    // Build Markdown report
    const markdown = `# Vendor Comparison Report

## 🏆 Recommended Supplier

**${winner.supplier}**

- **Total Cost of Ownership:** ${formatCurrency(winner.tco, winner.currency, locale)} {${winner.source}}
- **Lead Time:** ${winner.lead_time ? `${winner.lead_time} weeks` : '[Data Gap]'}
- **Risk Score:** ${winner.risk_score}/100 (${winner.risk_level})
- **Savings vs. Highest:** ${formatCurrency(savings, winner.currency, locale)} (${formatPercent(savingsPercent, locale)})

---

## 📊 Vendor Comparison Table

| Supplier | Quoted Price | TCO | Lead Time | Risk Score | Risk Level |
|----------|-------------|-----|-----------|------------|------------|
${vendors.map((v: any) => 
  `| ${v.supplier} | ${formatCurrency(v.quoted_price, v.currency, locale)} | ${formatCurrency(v.tco, v.currency, locale)} | ${v.lead_time ? `${v.lead_time}w` : '[Gap]'} | ${v.risk_score}/100 | ${v.risk_level} |`
).join('\n')}

---

## 🎯 Risk Score Analysis

${vendors.map((v: any) => `### ${v.supplier} - Risk Score: ${v.risk_score}/100 (${v.risk_level})

**Analysis:** ${v.risk_explanation}

**Risk Reduction:** ${v.what_lowers_risk}

**Breakdown:**
${v.risk_factors.map((f: any) => {
  const sign = f.subscore !== null && f.subscore <= 3 ? '+' : f.subscore !== null && f.subscore >= 7 ? '−' : '•';
  return `${sign} **${f.factor}** (weight: ${(f.weight * 100).toFixed(0)}%, score: ${f.subscore !== null ? f.subscore : 'N/A'}): ${f.evidence || '[Data Gap]'}`;
}).join('\n')}
`).join('\n---\n\n')}

---

## ⚠️ Issues & Clarifications

${vendors.map((v: any) => {
  if (v.issues.length === 0) {
    return `### ${v.supplier}\n\n✅ No critical issues identified.`;
  }
  
  return `### ${v.supplier}

${v.issues.map((issue: any) => 
  `${getSeverityIcon(issue.severity)} **${issue.title}** (${issue.severity})
- ${issue.detail}
- Source: ${issue.source}
- Suggested Question: *${issue.suggested_question}*`
).join('\n\n')}`;
}).join('\n\n---\n\n')}

---

## 🔧 Technical Specifications (BOM)

| Supplier | Tubes | Fibers | Outer Diameter | Weight | Bend Radius | Length | Standards | Certifications |
|----------|-------|--------|----------------|--------|-------------|--------|-----------|----------------|
${vendors.map((v: any) => {
  const specs = v.bom?.specs || {};
  const sources = v.bom?.sources || {};
  return `| ${v.supplier} | ${specs.tubes || '[Gap]'}${sources.tubes ? ` {${sources.tubes}}` : ''} | ${specs.fibers || '[Gap]'}${sources.fibers ? ` {${sources.fibers}}` : ''} | ${specs.outer_diameter || '[Gap]'}${sources.outer_diameter ? ` {${sources.outer_diameter}}` : ''} | ${specs.weight || '[Gap]'}${sources.weight ? ` {${sources.weight}}` : ''} | ${specs.bend_radius || '[Gap]'}${sources.bend_radius ? ` {${sources.bend_radius}}` : ''} | ${specs.length || '[Gap]'}${sources.length ? ` {${sources.length}}` : ''} | ${specs.standards?.join(', ') || '[Gap]'}${sources.standards ? ` {${sources.standards}}` : ''} | ${specs.certifications?.join(', ') || '[Gap]'}${sources.certifications ? ` {${sources.certifications}}` : ''} |`;
}).join('\n')}

${vendors.some((v: any) => v.bom?.conflicts) ? `
### Conflicting Data

${vendors.filter((v: any) => v.bom?.conflicts).map((v: any) => `**${v.supplier}:**
${Object.entries(v.bom.conflicts).map(([field, values]: [string, any]) => 
  `- ${field}: ${values.join(' vs ')}`
).join('\n')}`).join('\n\n')}` : ''}

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
