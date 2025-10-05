import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const authHeader = req.headers.get('Authorization')!;
    const token = authHeader.replace('Bearer ', '');
    const { data: { user } } = await supabaseClient.auth.getUser(token);

    if (!user) {
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { jobId } = await req.json();

    if (!jobId) {
      return new Response(JSON.stringify({ error: 'Job ID is required' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch job results
    const { data: job, error: jobError } = await supabaseClient
      .from('processing_jobs')
      .select(`
        *,
        documents!inner(user_id, filename)
      `)
      .eq('id', jobId)
      .eq('documents.user_id', user.id)
      .single();

    if (jobError || !job) {
      console.error('Job fetch error:', jobError);
      return new Response(JSON.stringify({ error: 'Job not found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    if (job.job_status !== 'completed') {
      return new Response(JSON.stringify({ error: 'Job not completed yet' }), {
        status: 400,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Fetch vendor offers with related data
    const { data: vendors, error: vendorsError } = await supabaseClient
      .from('vendor_offers')
      .select(`
        *,
        tco_calculations(*),
        risk_assessments(*),
        lead_time_analysis(*)
      `)
      .eq('document_id', job.document_id);

    if (vendorsError || !vendors || vendors.length === 0) {
      console.error('Vendors fetch error:', vendorsError);
      return new Response(JSON.stringify({ error: 'No vendor data found' }), {
        status: 404,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    // Prepare data for AI recommendation with full vendor details
    const comparisonData = vendors.map(v => ({
      vendor: v.vendor_name,
      price: v.quoted_price,
      currency: v.currency,
      items_count: v.items_count,
      tco: v.tco_calculations?.[0]?.calculated_tco || v.quoted_price,
      tco_breakdown: v.tco_calculations?.[0]?.breakdown || {},
      risk_score: v.risk_assessments?.[0]?.risk_score || 0,
      risk_factors: v.risk_assessments?.[0]?.risk_factors || [],
      lead_time: v.lead_time_analysis?.[0]?.estimated_lead_time || 0,
      extracted_data: v.extracted_data || {},
    }));

    // Generate AI recommendation
    const LOVABLE_API_KEY = Deno.env.get('LOVABLE_API_KEY');
    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${LOVABLE_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          {
            role: 'system',
            content: 'You are a procurement analyst. Generate concise, professional recommendations based on vendor comparison data.'
          },
          {
            role: 'user',
            content: `Based on this vendor comparison data, provide a recommendation statement (2-3 sentences):
${JSON.stringify(comparisonData, null, 2)}`
          }
        ],
      }),
    });

    if (!aiResponse.ok) {
      console.error('AI API error:', await aiResponse.text());
      throw new Error('Failed to generate recommendation');
    }

    const aiData = await aiResponse.json();
    const recommendation = aiData.choices[0].message.content;

    // Generate HTML report
    const html = generateHTMLReport(job, vendors, recommendation);

    return new Response(JSON.stringify({ 
      html,
      recommendation,
      filename: `vendor-comparison-${jobId.slice(0, 8)}.html`
    }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error generating report:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error occurred' 
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});

// Helpers to derive missing sections from extracted_data on older jobs
function deriveSpecsFromItems(items: any[] | undefined) {
  const specs: any = {};
  if (!Array.isArray(items)) return specs;
  for (const raw of items) {
    const name = String(raw?.name || raw?.name_original || raw?.description || '').toLowerCase();
    if (!specs.tubes && (name.includes('tube') || name.includes('rør'))) specs.tubes = raw?.part_number || raw?.description || '';
    if (!specs.fibers && name.includes('fiber')) specs.fibers = raw?.part_number || raw?.description || '';
    if (!specs.outerDiameter && (name.includes('outer diameter') || name.includes('diameter') || name.includes('od'))) specs.outerDiameter = raw?.description || '';
    if (!specs.weight && (name.includes('weight') || name.includes('vekt'))) specs.weight = raw?.description || '';
    if (!specs.bendRadius && (name.includes('bend') || name.includes('bøy'))) specs.bendRadius = raw?.description || '';
    if (!specs.length && (name.includes('length') || name.includes('lengde'))) specs.length = raw?.description || '';
    if (!specs.specification && (name.includes('spec') || name.includes('standard'))) specs.specification = raw?.description || '';
    if (!specs.certification && name.includes('iso')) specs.certification = raw?.description || 'ISO';
  }
  return specs;
}

function deriveIssuesFromData(extractedData: any) {
  const issues: string[] = [];
  const items = Array.isArray(extractedData?.items) ? extractedData.items : [];
  const hasWarranty = !!extractedData?.terms?.warranty || items.some((i: any) => i?.warranty);
  if (!hasWarranty) issues.push('Warranty information not specified');
  const hasDelivery = !!extractedData?.terms?.delivery || items.some((i: any) => i?.delivery);
  if (!hasDelivery) issues.push('Delivery terms unclear');
  const hasISO = items.some((i: any) => String(i?.name || i?.name_original || '').toLowerCase().includes('iso'));
  if (!hasISO) issues.push('Missing ISO 9001 certification');
  return issues;
}

function generateHTMLReport(job: any, vendors: any[], recommendation: string): string {
  const bestVendor = vendors.reduce((best, current) => {
    const currentTCO = current.tco_calculations?.[0]?.calculated_tco || current.quoted_price;
    const bestTCO = best.tco_calculations?.[0]?.calculated_tco || best.quoted_price;
    return currentTCO < bestTCO ? current : best;
  });

  const worstVendor = vendors.reduce((worst, current) => {
    const currentTCO = current.tco_calculations?.[0]?.calculated_tco || current.quoted_price;
    const worstTCO = worst.tco_calculations?.[0]?.calculated_tco || worst.quoted_price;
    return currentTCO > worstTCO ? current : worst;
  });

  const bestTCO = bestVendor.tco_calculations?.[0]?.calculated_tco || bestVendor.quoted_price;
  const worstTCO = worstVendor.tco_calculations?.[0]?.calculated_tco || worstVendor.quoted_price;
  const savings = worstTCO - bestTCO;
  const avgTCO = vendors.reduce((sum, v) => sum + (v.tco_calculations?.[0]?.calculated_tco || v.quoted_price), 0) / vendors.length;
  const highRiskCount = vendors.filter(v => (v.risk_assessments?.[0]?.risk_score || 0) >= 70).length;

  const vendorRows = vendors.map(v => {
    const tco = v.tco_calculations?.[0]?.calculated_tco || v.quoted_price;
    const riskScore = v.risk_assessments?.[0]?.risk_score || 0;
    const leadTime = v.lead_time_analysis?.[0]?.estimated_lead_time || 0;
    const riskLevel = riskScore >= 70 ? 'High' : riskScore >= 40 ? 'Medium' : 'Low';
    const isRecommended = v.id === bestVendor.id;

    return `
      <tr style="${isRecommended ? 'background-color: #f0fdf4;' : ''}">
        <td style="padding: 12px; border: 1px solid #e5e7eb;">${v.vendor_name}${isRecommended ? ' ⭐' : ''}</td>
        <td style="padding: 12px; border: 1px solid #e5e7eb;">${v.currency} ${Number(v.quoted_price).toLocaleString()}</td>
        <td style="padding: 12px; border: 1px solid #e5e7eb;">${v.currency} ${Number(tco).toLocaleString()}</td>
        <td style="padding: 12px; border: 1px solid #e5e7eb;">${leadTime} days</td>
        <td style="padding: 12px; border: 1px solid #e5e7eb;">${riskScore}/100</td>
        <td style="padding: 12px; border: 1px solid #e5e7eb;">
          <span style="padding: 4px 8px; border-radius: 4px; background-color: ${
            riskLevel === 'High' ? '#fee2e2' : riskLevel === 'Medium' ? '#fef3c7' : '#dcfce7'
          }; color: ${
            riskLevel === 'High' ? '#991b1b' : riskLevel === 'Medium' ? '#92400e' : '#166534'
          };">
            ${riskLevel}
          </span>
        </td>
      </tr>
    `;
  }).join('');

  // Risk Score Analysis section
  const riskAnalysis = vendors.map(v => {
    const risk = v.risk_assessments?.[0];
    const riskScore = risk?.risk_score || 0;
    let riskFactors: string[] = Array.isArray(risk?.risk_factors) ? risk.risk_factors : [];
    if (riskFactors.length === 0) {
      const extracted = v.extracted_data || {};
      const derived = deriveIssuesFromData(extracted);
      riskFactors = Array.isArray(extracted.issues) && extracted.issues.length > 0 ? extracted.issues : derived;
    }
    
    return `
      <div style="margin-bottom: 15px;">
        <h3 style="color: #1f2937; margin: 5px 0;">${v.vendor_name} (Risk Score: ${riskScore}/100)</h3>
        ${riskFactors.length > 0 ? `
          <ul style="margin: 5px 0 15px 0; padding-left: 20px;">
            ${riskFactors.map((factor: string) => `<li>${factor}</li>`).join('')}
          </ul>
        ` : '<p style="margin: 5px 0; color: #6b7280;">No specific risk factors identified</p>'}
      </div>
    `;
  }).join('');

  // Issues & Clarifications section (always render)
  const issuesSectionHTML = (() => {
    const sections = vendors.map(v => {
      const extractedData = v.extracted_data || {};
      const issues = (Array.isArray(extractedData.issues) && extractedData.issues.length > 0)
        ? extractedData.issues
        : deriveIssuesFromData(extractedData);
      if (issues.length === 0) return '';
      return `
        <div style="margin-bottom: 15px;">
          <h3 style="color: #1f2937; margin: 5px 0;">${v.vendor_name} (${issues.length} ${issues.length === 1 ? 'issue' : 'issues'})</h3>
          <ul style="margin: 5px 0 15px 0; padding-left: 20px;">
            ${issues.map((issue: string) => `<li>${issue}</li>`).join('')}
          </ul>
        </div>
      `;
    }).join('');

    if (sections.trim().length === 0) {
      return `
        <h2>ISSUES & CLARIFICATIONS NEEDED</h2>
        <p style="margin: 5px 0; color: #6b7280;">No issues identified across vendors.</p>
      `;
    }

    return `
      <h2>ISSUES & CLARIFICATIONS NEEDED</h2>
      ${sections}
    `;
  })();

  // Technical Specifications (BOM) table
  const bomTable = `
    <table>
      <thead>
        <tr>
          <th>Company</th>
          <th>Tubes</th>
          <th>Fibers</th>
          <th>OD</th>
          <th>Weight</th>
          <th>Bend Radius</th>
          <th>Length</th>
          <th>Spec</th>
          <th>Cert</th>
        </tr>
      </thead>
      <tbody>
        ${vendors.map(v => {
          const extracted = v.extracted_data || {};
          const hasTech = extracted.technical_specs && Object.keys(extracted.technical_specs || {}).length > 0;
          const specs = hasTech ? extracted.technical_specs : deriveSpecsFromItems(extracted.items);
          return `
            <tr>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${v.vendor_name}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${specs.tubes || 'N/A'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${specs.fibers || 'N/A'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${specs.outerDiameter || 'N/A'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${specs.weight || 'Not specified'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${specs.bendRadius || 'N/A'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${specs.length || 'N/A'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${specs.specification || 'N/A'}</td>
              <td style="padding: 12px; border: 1px solid #e5e7eb;">${specs.certification || 'N/A'}</td>
            </tr>
          `;
        }).join('')}
      </tbody>
    </table>
  `;

  const vendorDetails = vendors.map(v => {
    const tco = v.tco_calculations?.[0];
    const risk = v.risk_assessments?.[0];
    const leadTime = v.lead_time_analysis?.[0];

    return `
      <div style="margin-bottom: 30px; page-break-inside: avoid;">
        <h3 style="color: #1f2937; margin-bottom: 15px; border-bottom: 2px solid #3b82f6; padding-bottom: 8px;">
          ${v.vendor_name}
        </h3>
        
        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 15px;">
          <div>
            <p style="margin: 5px 0;"><strong>Quoted Price:</strong> ${v.currency} ${Number(v.quoted_price).toLocaleString()}</p>
            <p style="margin: 5px 0;"><strong>Items Count:</strong> ${v.items_count}</p>
          </div>
          <div>
            <p style="margin: 5px 0;"><strong>Total Cost of Ownership:</strong> ${v.currency} ${Number(tco?.calculated_tco || v.quoted_price).toLocaleString()}</p>
            <p style="margin: 5px 0;"><strong>Lead Time:</strong> ${leadTime?.estimated_lead_time || 'N/A'} days</p>
          </div>
        </div>

        ${tco ? `
          <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin-bottom: 15px;">
            <h4 style="color: #374151; margin-top: 0;">TCO Breakdown</h4>
            <ul style="margin: 5px 0; padding-left: 20px;">
              ${Object.entries(tco.breakdown || {}).map(([key, value]) => 
                `<li><strong>${key}:</strong> ${v.currency} ${Number(value).toLocaleString()}</li>`
              ).join('')}
            </ul>
          </div>
        ` : ''}

        ${risk ? `
          <div style="background-color: #fef3c7; padding: 15px; border-radius: 8px;">
            <h4 style="color: #374151; margin-top: 0;">Risk Assessment</h4>
            <p><strong>Risk Score:</strong> ${risk.risk_score}/100</p>
            ${Array.isArray(risk.risk_factors) && risk.risk_factors.length > 0 ? `
              <ul style="margin: 5px 0; padding-left: 20px;">
                ${risk.risk_factors.map((factor: string) => `<li>${factor}</li>`).join('')}
              </ul>
            ` : ''}
          </div>
        ` : ''}
      </div>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Vendor Comparison Report</title>
  <style>
    body {
      font-family: Arial, sans-serif;
      line-height: 1.6;
      color: #333;
      max-width: 1200px;
      margin: 0 auto;
      padding: 20px;
      background-color: #ffffff;
    }
    h1 { color: #1f2937; border-bottom: 3px solid #3b82f6; padding-bottom: 10px; }
    h2 { color: #374151; margin-top: 30px; }
    table {
      width: 100%;
      border-collapse: collapse;
      margin: 20px 0;
      box-shadow: 0 1px 3px rgba(0,0,0,0.1);
    }
    th {
      background-color: #3b82f6;
      color: white;
      padding: 12px;
      text-align: left;
      border: 1px solid #2563eb;
    }
    .recommendation-box {
      background-color: #dbeafe;
      border-left: 4px solid #3b82f6;
      padding: 15px 20px;
      margin: 20px 0;
      border-radius: 4px;
    }
    .metadata {
      color: #6b7280;
      font-size: 0.9em;
      margin-bottom: 20px;
    }
    @media print {
      body { padding: 0; }
      .no-print { display: none; }
    }
  </style>
</head>
<body>
  <h1>Vendor Comparison Report</h1>
  
  <div style="background-color: #dbeafe; border-left: 4px solid #3b82f6; padding: 20px; margin: 20px 0; border-radius: 4px;">
    <h2 style="margin-top: 0; color: #1f2937;">Winner: ${bestVendor.vendor_name}</h2>
    <p style="font-size: 1.2em; margin: 10px 0;">
      <strong>TCO:</strong> ${bestVendor.currency} ${Number(bestTCO).toLocaleString()} &nbsp; | &nbsp;
      <strong>Lead Time:</strong> ${bestVendor.lead_time_analysis?.[0]?.estimated_lead_time || 'N/A'} days
    </p>
    <p style="color: #059669; font-weight: bold; font-size: 1.1em;">
      Saves ${bestVendor.currency} ${Number(savings).toLocaleString()} vs worst option
    </p>
  </div>

  <table>
    <thead>
      <tr>
        <th>Vendor</th>
        <th>Quoted Price</th>
        <th>Total TCO</th>
        <th>Lead Time</th>
        <th>Risk Score</th>
        <th>Risk Level</th>
      </tr>
    </thead>
    <tbody>
      ${vendorRows}
    </tbody>
  </table>

  <h2>Summary Statistics:</h2>
  <div style="background-color: #f9fafb; padding: 15px; border-radius: 8px; margin: 20px 0;">
    <p style="margin: 5px 0;"><strong>Total Vendors Analyzed:</strong> ${vendors.length}</p>
    <p style="margin: 5px 0;"><strong>Average TCO:</strong> ${bestVendor.currency} ${Number(avgTCO).toLocaleString()}</p>
    <p style="margin: 5px 0;"><strong>High Risk Vendors:</strong> ${highRiskCount}</p>
  </div>

  <h2>Risk Score Analysis</h2>
  ${riskAnalysis}

  ${issuesSectionHTML}

  <h2>Technical Specifications (BOM)</h2>
  ${bomTable}

  <div style="margin-top: 40px; padding-top: 20px; border-top: 1px solid #e5e7eb; color: #6b7280; font-size: 0.85em;">
    <p>Generated on ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'numeric', year: 'numeric' })}, ${new Date().toLocaleTimeString('en-GB')}</p>
  </div>
</body>
</html>
  `;
}
