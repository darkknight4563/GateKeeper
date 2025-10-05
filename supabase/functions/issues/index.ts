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
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const { documents, scores } = await req.json();

    if (!documents || !Array.isArray(documents)) {
      return new Response(
        JSON.stringify({ error: 'documents array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GUARD: Refuse to detect issues if critical fields are all missing
    const hasCriticalData = documents.some(d => 
      d.terms?.delivery_weeks != null || 
      d.terms?.warranty_months != null ||
      d.totals?.quoted_price != null
    );

    if (!hasCriticalData) {
      console.error('[ISSUES] GUARD: No critical data (delivery_weeks, warranty_months, quoted_price) in any document');
      return new Response(
        JSON.stringify({ 
          error: 'No critical data found in documents',
          documents_checked: documents.length,
          message: 'At least one document must have delivery_weeks, warranty_months, or quoted_price'
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[ISSUES] Analyzing ${documents.length} suppliers for issues`);

    const allIssues: any[] = [];

    for (const doc of documents) {
      const supplier = doc.supplier || "[Unknown Supplier]";
      const scoreData = scores?.find((s: any) => s.doc_id === doc.doc_id);

      console.log(`[ISSUES] Checking ${supplier}`);

      // 1. PRICE MISMATCH
      const quotedPrice = doc.totals?.quoted_price;
      const calculatedTotal = doc.totals?.calculated_total;
      const priceSource = doc.totals?.source || "[No source]";

      if (quotedPrice !== null && quotedPrice !== undefined && 
          calculatedTotal !== null && calculatedTotal !== undefined && 
          quotedPrice > 0) {
        
        const priceDiff = Math.abs(quotedPrice - calculatedTotal);
        const percentDiff = (priceDiff / quotedPrice) * 100;

        if (percentDiff > 1.5) {
          const currency = doc.currency || "USD";
          const diffFormatted = priceDiff.toLocaleString('en-US', { maximumFractionDigits: 0 });
          
          allIssues.push({
            supplier,
            severity: "High",
            title: "PRICE MISMATCH",
            detail: `Quoted ${currency} ${quotedPrice.toLocaleString()} vs calculated ${currency} ${calculatedTotal.toLocaleString()} (Δ ${currency} ${diffFormatted}, ${percentDiff.toFixed(1)}%)`,
            source: priceSource,
            suggested_question: "Confirm final price basis and inclusions."
          });
        }
      } else if (quotedPrice === null || quotedPrice === undefined) {
        allIssues.push({
          supplier,
          severity: "Medium",
          title: "PRICE MISSING",
          detail: "[Needs confirmation] Quoted price not found in document",
          source: priceSource,
          suggested_question: "Please provide the total quoted price."
        });
      }

      // 2. SCHEDULE GAPS
      const deliveryWeeks = doc.terms?.delivery_weeks;
      const termsSource = doc.terms?.source || "[No source]";

      if (deliveryWeeks === null || deliveryWeeks === undefined) {
        allIssues.push({
          supplier,
          severity: "Medium",
          title: "SCHEDULE MISSING",
          detail: "[Needs confirmation] Delivery schedule not specified",
          source: termsSource,
          suggested_question: "What is the expected delivery timeline?"
        });
      }

      // Check for multi-split deliveries in line items
      const hasMultipleDeliveries = doc.line_items?.filter((item: any) => 
        /delivery|shipment|batch|phase/i.test(item.name || "")
      ).length > 1;

      if (hasMultipleDeliveries) {
        const deliveryItems = doc.line_items.filter((item: any) => 
          /delivery|shipment|batch|phase/i.test(item.name || "")
        );
        
        allIssues.push({
          supplier,
          severity: "Medium",
          title: "SCHEDULE GAPS",
          detail: `Multi-split delivery detected: ${deliveryItems.length} delivery phases identified`,
          source: deliveryItems.map((i: any) => i.source).join(', '),
          suggested_question: "Confirm exact dates for each delivery phase and dependencies."
        });
      }

      // 3. WARRANTY MISSING/SHORT
      const warrantyMonths = doc.terms?.warranty_months;

      if (warrantyMonths === null || warrantyMonths === undefined) {
        allIssues.push({
          supplier,
          severity: "Medium",
          title: "WARRANTY MISSING",
          detail: "[Needs confirmation] Warranty terms not specified",
          source: termsSource,
          suggested_question: "What warranty period is included?"
        });
      } else if (warrantyMonths < 12) {
        allIssues.push({
          supplier,
          severity: "Medium",
          title: "WARRANTY SHORT",
          detail: `Only ${warrantyMonths} months warranty provided (below 12-month standard)`,
          source: termsSource,
          suggested_question: "Can warranty be extended to at least 12 months?"
        });
      }

      // 4. TERMS AMBIGUOUS
      const paymentTerms = doc.terms?.payment_terms;
      const validityDays = doc.terms?.validity_days;

      if (!paymentTerms || paymentTerms.trim().length === 0) {
        allIssues.push({
          supplier,
          severity: "Low",
          title: "PAYMENT TERMS AMBIGUOUS",
          detail: "[Needs confirmation] Payment terms not clearly specified",
          source: termsSource,
          suggested_question: "Clarify payment schedule and milestones."
        });
      }

      if (validityDays === null || validityDays === undefined) {
        allIssues.push({
          supplier,
          severity: "Low",
          title: "QUOTE VALIDITY UNCLEAR",
          detail: "[Needs confirmation] Quote validity period not specified",
          source: termsSource,
          suggested_question: "How long is this quote valid?"
        });
      }

      // 5. CERTIFICATION GAPS
      const hasISO = doc.line_items?.some((item: any) => 
        /iso|api|certification|certified/i.test(item.name || "")
      );

      if (!hasISO) {
        allIssues.push({
          supplier,
          severity: "Medium",
          title: "CERTIFICATION MISSING",
          detail: "[Needs confirmation] No ISO 9001 or API certification evidence found",
          source: "Document content",
          suggested_question: "Confirm ISO 9001 certification status and provide documentation."
        });
      }

      // 6. LINE ITEM GAPS
      const incompleteItems = doc.line_items?.filter((item: any) => 
        item.qty === null || item.unit_price === null || item.subtotal === null
      ) || [];

      if (incompleteItems.length > 0) {
        allIssues.push({
          supplier,
          severity: "Low",
          title: "INCOMPLETE LINE ITEMS",
          detail: `${incompleteItems.length} line item(s) missing quantity, unit price, or subtotal`,
          source: incompleteItems.map((i: any) => i.source).slice(0, 3).join(', '),
          suggested_question: "Provide complete pricing details for all line items."
        });
      }

      // 7. CURRENCY CLARITY
      if (!doc.currency || doc.currency === null) {
        allIssues.push({
          supplier,
          severity: "Medium",
          title: "CURRENCY NOT SPECIFIED",
          detail: "[Needs confirmation] Currency not clearly indicated in document",
          source: priceSource,
          suggested_question: "Confirm currency for all quoted prices."
        });
      }
    }

    // Sort issues by severity and supplier
    const severityOrder = { "High": 0, "Medium": 1, "Low": 2 };
    allIssues.sort((a, b) => {
      const sevDiff = severityOrder[a.severity as keyof typeof severityOrder] - 
                      severityOrder[b.severity as keyof typeof severityOrder];
      if (sevDiff !== 0) return sevDiff;
      return a.supplier.localeCompare(b.supplier);
    });

    // Group by supplier for summary
    const issuesBySupplier: Record<string, any[]> = {};
    for (const issue of allIssues) {
      if (!issuesBySupplier[issue.supplier]) {
        issuesBySupplier[issue.supplier] = [];
      }
      issuesBySupplier[issue.supplier].push(issue);
    }

    const response = {
      issues: allIssues,
      summary: {
        total_issues: allIssues.length,
        by_severity: {
          high: allIssues.filter(i => i.severity === "High").length,
          medium: allIssues.filter(i => i.severity === "Medium").length,
          low: allIssues.filter(i => i.severity === "Low").length
        },
        by_supplier: Object.entries(issuesBySupplier).map(([supplier, issues]) => ({
          supplier,
          issue_count: issues.length,
          highest_severity: issues[0]?.severity || "Low"
        }))
      },
      metadata: {
        suppliers_analyzed: documents.length,
        timestamp: new Date().toISOString()
      }
    };

    console.log(`[ISSUES] Found ${allIssues.length} issues across ${documents.length} suppliers`);

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[ISSUES] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Issue detection failed',
        issues: []
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
