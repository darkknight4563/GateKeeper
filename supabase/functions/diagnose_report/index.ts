import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Required fields per pipeline stage
const REQUIRED_FIELDS = {
  extract: {
    supplier: 'Supplier/vendor name',
    quoted_price: 'Total quoted price/amount',
    currency: 'Currency code (USD, EUR, etc.)',
    delivery_weeks: 'Delivery timeline in weeks',
    line_items: 'Individual line items/products',
    payment_terms: 'Payment terms/conditions',
    quote_validity: 'Quote validity period'
  },
  score: {
    risk_score: 'Overall risk score (0-100)',
    factors: 'Risk factor breakdown',
    explanation: 'Risk explanation text',
    what_lowers_risk: 'Risk mitigation suggestions'
  },
  issues: {
    severity: 'Issue severity level',
    title: 'Issue title/type',
    detail: 'Detailed description',
    source: 'Source file and location',
    suggested_question: 'Follow-up question'
  },
  bom: {
    specs: 'Technical specifications object',
    sources: 'Source references for each spec',
    tubes: 'Number of tubes',
    fibers: 'Number of fibers',
    standards: 'Applicable standards',
    certifications: 'Quality certifications'
  }
};

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
      session_id 
    } = await req.json();

    console.log('Diagnosing pipeline state:', {
      session_id,
      documentsProvided: !!documents,
      scoresProvided: !!scores,
      issuesProvided: !!issues,
      bomProvided: !!bom
    });

    const diagnostics: any = {
      session_id,
      timestamp: new Date().toISOString(),
      stages: {},
      missing_data: [],
      exact_reasons: [],
      next_steps: [],
      rag_index_status: 'not_checked'
    };

    // Diagnose EXTRACT stage
    diagnostics.stages.extract = {
      status: 'unknown',
      documents_count: 0,
      issues: [],
      missing_fields: []
    };

    if (!documents || documents.length === 0) {
      diagnostics.stages.extract.status = 'missing';
      diagnostics.exact_reasons.push('EXACT: No documents array provided to pipeline');
      diagnostics.missing_data.push('extract');
      diagnostics.next_steps.push('Run /extract command with uploaded document file_ids');
    } else {
      diagnostics.stages.extract.documents_count = documents.length;
      let hasIssues = false;

      documents.forEach((doc: any, idx: number) => {
        const docIssues: string[] = [];
        
        if (!doc.supplier || doc.supplier.trim() === '') {
          docIssues.push('No supplier name parsed');
          diagnostics.exact_reasons.push(`EXACT: Document ${idx + 1} - No supplier names parsed from file`);
          hasIssues = true;
        }

        if (!doc.quoted_price && doc.quoted_price !== 0) {
          docIssues.push('No quoted price found');
          diagnostics.exact_reasons.push(`EXACT: Document ${idx + 1} - No price/amount extracted from document`);
          hasIssues = true;
        }

        if (!doc.delivery_weeks && !doc.lead_time) {
          docIssues.push('No delivery weeks found');
          diagnostics.exact_reasons.push(`EXACT: Document ${idx + 1} - No delivery weeks found in document`);
          hasIssues = true;
        }

        if (!doc.line_items || doc.line_items.length === 0) {
          docIssues.push('No line items extracted');
          diagnostics.exact_reasons.push(`EXACT: Document ${idx + 1} - Line items table not detected or empty`);
          hasIssues = true;
        }

        if (!doc.currency) {
          docIssues.push('Currency not specified');
          diagnostics.exact_reasons.push(`EXACT: Document ${idx + 1} - Currency symbol/code not found`);
          hasIssues = true;
        }

        if (docIssues.length > 0) {
          diagnostics.stages.extract.issues.push({
            document_index: idx,
            supplier: doc.supplier || '[unknown]',
            issues: docIssues
          });
        }

        // Check for required fields
        Object.keys(REQUIRED_FIELDS.extract).forEach(field => {
          const fieldKey = field as keyof typeof REQUIRED_FIELDS.extract;
          if (!doc[field] || (Array.isArray(doc[field]) && doc[field].length === 0)) {
            diagnostics.stages.extract.missing_fields.push({
              document: idx,
              field,
              description: REQUIRED_FIELDS.extract[fieldKey]
            });
          }
        });
      });

      diagnostics.stages.extract.status = hasIssues ? 'partial' : 'complete';
      
      if (hasIssues) {
        diagnostics.next_steps.push('Re-run /extract with better document quality or check file format');
        diagnostics.next_steps.push('Verify documents contain vendor quotes with prices and line items');
      }
    }

    // Diagnose SCORE stage
    diagnostics.stages.score = {
      status: 'unknown',
      scores_count: 0,
      issues: [],
      missing_fields: []
    };

    if (!scores || scores.length === 0) {
      diagnostics.stages.score.status = 'missing';
      diagnostics.exact_reasons.push('EXACT: No risk scores calculated - /score not run or returned empty');
      diagnostics.missing_data.push('score');
      diagnostics.next_steps.push('Run /score command with extracted documents');
    } else {
      diagnostics.stages.score.scores_count = scores.length;
      let hasIssues = false;

      scores.forEach((score: any, idx: number) => {
        const scoreIssues: string[] = [];

        if (score.risk_score === null || score.risk_score === undefined) {
          scoreIssues.push('Risk score not calculated');
          diagnostics.exact_reasons.push(`EXACT: Supplier ${score.supplier} - Risk score computation failed`);
          hasIssues = true;
        }

        if (!score.factors || score.factors.length === 0) {
          scoreIssues.push('No risk factors breakdown');
          diagnostics.exact_reasons.push(`EXACT: Supplier ${score.supplier} - Risk factors array empty`);
          hasIssues = true;
        } else {
          const nullFactors = score.factors.filter((f: any) => f.subscore === null);
          if (nullFactors.length > 0) {
            scoreIssues.push(`${nullFactors.length} factors have null subscores (missing data)`);
            diagnostics.exact_reasons.push(`EXACT: Supplier ${score.supplier} - Missing data for: ${nullFactors.map((f: any) => f.factor).join(', ')}`);
          }
        }

        if (!score.explanation || score.explanation === '[Data Gap]') {
          scoreIssues.push('No risk explanation generated');
          hasIssues = true;
        }

        if (scoreIssues.length > 0) {
          diagnostics.stages.score.issues.push({
            supplier: score.supplier,
            issues: scoreIssues
          });
        }
      });

      diagnostics.stages.score.status = hasIssues ? 'partial' : 'complete';
      
      if (hasIssues) {
        diagnostics.next_steps.push('Check if extracted documents have required risk-related fields (delivery_weeks, warranty, certifications)');
      }
    }

    // Diagnose ISSUES stage
    diagnostics.stages.issues = {
      status: 'unknown',
      issues_count: 0,
      by_severity: { High: 0, Medium: 0, Low: 0 },
      missing_fields: []
    };

    if (!issues || issues.length === 0) {
      diagnostics.stages.issues.status = 'missing';
      diagnostics.exact_reasons.push('EXACT: No issues detected - /issues not run or no problems found');
      diagnostics.missing_data.push('issues');
      diagnostics.next_steps.push('Run /issues command with extracted documents and scores');
    } else {
      diagnostics.stages.issues.issues_count = issues.length;
      
      issues.forEach((issue: any) => {
        if (issue.severity) {
          diagnostics.stages.issues.by_severity[issue.severity] = 
            (diagnostics.stages.issues.by_severity[issue.severity] || 0) + 1;
        }

        if (!issue.source || issue.source === '[Unknown]') {
          diagnostics.stages.issues.missing_fields.push({
            issue_title: issue.title,
            field: 'source',
            problem: 'No source file reference'
          });
        }
      });

      diagnostics.stages.issues.status = 'complete';
    }

    // Diagnose BOM stage
    diagnostics.stages.bom = {
      status: 'unknown',
      bom_count: 0,
      issues: [],
      missing_fields: []
    };

    if (!bom || bom.length === 0) {
      diagnostics.stages.bom.status = 'missing';
      diagnostics.exact_reasons.push('EXACT: No BOM/specifications extracted - /bom not run');
      diagnostics.missing_data.push('bom');
      diagnostics.next_steps.push('Run /bom command to extract technical specifications');
    } else {
      diagnostics.stages.bom.bom_count = bom.length;
      let hasIssues = false;

      bom.forEach((b: any, idx: number) => {
        const bomIssues: string[] = [];

        if (!b.specs) {
          bomIssues.push('Specs object missing');
          diagnostics.exact_reasons.push(`EXACT: Supplier ${b.supplier} - No specs object in BOM data`);
          hasIssues = true;
        } else {
          const criticalFields = ['tubes', 'fibers', 'standards', 'certifications'];
          const missingCritical = criticalFields.filter(field => 
            !b.specs[field] || (Array.isArray(b.specs[field]) && b.specs[field].length === 0)
          );

          if (missingCritical.length > 0) {
            bomIssues.push(`Missing critical specs: ${missingCritical.join(', ')}`);
            diagnostics.exact_reasons.push(`EXACT: Supplier ${b.supplier} - Technical specs incomplete: ${missingCritical.join(', ')} not found in document`);
            hasIssues = true;
          }
        }

        if (!b.sources || Object.keys(b.sources).length === 0) {
          bomIssues.push('No source references');
          diagnostics.exact_reasons.push(`EXACT: Supplier ${b.supplier} - Source file locations missing for BOM data`);
          hasIssues = true;
        }

        if (bomIssues.length > 0) {
          diagnostics.stages.bom.issues.push({
            supplier: b.supplier,
            issues: bomIssues
          });
        }
      });

      diagnostics.stages.bom.status = hasIssues ? 'partial' : 'complete';
      
      if (hasIssues) {
        diagnostics.next_steps.push('Check if documents contain technical specification tables/sections');
        diagnostics.next_steps.push('Verify document pages include standards (DNV, API, ISO) and certification info');
      }
    }

    // Check for demo/test data contamination
    const demoIndicators = [
      'demo', 'test', 'sample', 'example', 'placeholder'
    ];

    let hasDemoData = false;
    if (documents) {
      documents.forEach((doc: any) => {
        if (doc.supplier) {
          const supplierLower = doc.supplier.toLowerCase();
          if (demoIndicators.some(indicator => supplierLower.includes(indicator))) {
            hasDemoData = true;
            diagnostics.exact_reasons.push(`EXACT: RAG index includes demo docs - supplier name "${doc.supplier}" contains demo/test markers; purging recommended`);
          }
        }
        if (doc.source && doc.source.toLowerCase().includes('demo')) {
          hasDemoData = true;
          diagnostics.exact_reasons.push(`EXACT: RAG index includes demo docs - source file "${doc.source}" marked as demo; purging required`);
        }
      });
    }

    diagnostics.rag_index_status = hasDemoData ? 'contaminated_with_demo_data' : 'clean';
    
    if (hasDemoData) {
      diagnostics.next_steps.push('Run /reset_context to purge demo data and rebuild clean index');
    }

    // Build field checklist
    diagnostics.field_checklist = {
      extract: Object.entries(REQUIRED_FIELDS.extract).map(([field, desc]) => ({
        field,
        description: desc,
        status: documents?.some((d: any) => d[field]) ? 'found' : 'missing',
        scan_next: !documents?.some((d: any) => d[field]) ? 'Check all document pages for this field' : null
      })),
      score: Object.entries(REQUIRED_FIELDS.score).map(([field, desc]) => ({
        field,
        description: desc,
        status: scores?.some((s: any) => s[field]) ? 'found' : 'missing'
      })),
      issues: Object.entries(REQUIRED_FIELDS.issues).map(([field, desc]) => ({
        field,
        description: desc,
        status: issues?.some((i: any) => i[field]) ? 'found' : 'missing'
      })),
      bom: Object.entries(REQUIRED_FIELDS.bom).map(([field, desc]) => ({
        field,
        description: desc,
        status: bom?.some((b: any) => b[field] || b.specs?.[field]) ? 'found' : 'missing'
      }))
    };

    // Overall pipeline health
    const allStagesComplete = Object.values(diagnostics.stages).every(
      (stage: any) => stage.status === 'complete'
    );

    diagnostics.pipeline_health = allStagesComplete ? 'healthy' : 'degraded';
    
    if (diagnostics.exact_reasons.length === 0) {
      diagnostics.exact_reasons.push('Pipeline appears healthy - all stages have data');
    }

    console.log('Diagnostics complete:', {
      health: diagnostics.pipeline_health,
      missing_stages: diagnostics.missing_data,
      reasons_count: diagnostics.exact_reasons.length
    });

    return new Response(JSON.stringify(diagnostics), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in diagnose_report function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
