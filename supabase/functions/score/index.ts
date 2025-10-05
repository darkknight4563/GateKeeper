import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// Default risk weights
const DEFAULT_WEIGHTS = {
  schedule: 0.30,
  price_variance: 0.25,
  quality_cert: 0.15,
  warranty_terms: 0.10,
  payment_terms: 0.10,
  complexity: 0.10
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!;
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

    const { documents, weights } = await req.json();

    if (!documents || !Array.isArray(documents) || documents.length === 0) {
      return new Response(
        JSON.stringify({ error: 'documents array is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    // GUARD: Refuse to score if no delivery_weeks found in any document
    if (!documents.some(d => d.terms?.delivery_weeks != null)) {
      console.error('[SCORE] GUARD: No delivery_weeks found in any document');
      return new Response(
        JSON.stringify({ 
          error: 'No delivery_weeks found in any document',
          documents_checked: documents.length,
          missing_fields: documents.map((d, i) => ({
            doc_index: i,
            supplier: d.supplier,
            has_delivery_weeks: d.terms?.delivery_weeks != null
          }))
        }),
        { status: 422, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const riskWeights = { ...DEFAULT_WEIGHTS, ...weights };

    console.log(`[SCORE] Processing ${documents.length} suppliers with weights:`, riskWeights);

    // Calculate benchmark price for variance calculation
    const validPrices = documents
      .map(d => d.totals?.quoted_price)
      .filter(p => p !== null && p !== undefined && !isNaN(p));
    
    const benchmarkPrice = validPrices.length > 0 
      ? validPrices.reduce((sum, p) => sum + p, 0) / validPrices.length
      : null;

    console.log(`[SCORE] Benchmark price: ${benchmarkPrice}`);

    const scoredSuppliers = [];

    for (const doc of documents) {
      const supplier = doc.supplier || "[Unknown Supplier]";
      const factors = [];
      let totalWeightedScore = 0;
      let totalWeight = 0;

      console.log(`[SCORE] Scoring supplier: ${supplier}`);

      // 1. Schedule Risk (delivery_weeks)
      const deliveryWeeks = doc.terms?.delivery_weeks;
      const scheduleSource = doc.terms?.source || "[Data Gap] No source";
      
      let scheduleScore = null;
      let scheduleEvidence = scheduleSource;

      if (deliveryWeeks !== null && deliveryWeeks !== undefined) {
        // Longer delivery = higher risk
        // Scale: 0-20 weeks = 0-2, 21-40 = 3-6, 41-60 = 7-9, 60+ = 10
        if (deliveryWeeks <= 20) {
          scheduleScore = Math.min(2, deliveryWeeks / 10);
        } else if (deliveryWeeks <= 40) {
          scheduleScore = 2 + ((deliveryWeeks - 20) / 20) * 4;
        } else if (deliveryWeeks <= 60) {
          scheduleScore = 6 + ((deliveryWeeks - 40) / 20) * 3;
        } else {
          scheduleScore = Math.min(10, 9 + ((deliveryWeeks - 60) / 20));
        }
        scheduleEvidence = `${deliveryWeeks} weeks delivery at ${scheduleSource}`;
        totalWeightedScore += riskWeights.schedule * scheduleScore;
        totalWeight += riskWeights.schedule;
      } else {
        scheduleEvidence = `[Data Gap] Delivery time not specified at ${scheduleSource}`;
      }

      factors.push({
        factor: "Schedule",
        weight: riskWeights.schedule,
        subscore: scheduleScore,
        evidence: scheduleEvidence
      });

      // 2. Price Variance Risk
      const quotedPrice = doc.totals?.quoted_price;
      const priceSource = doc.totals?.source || "[Data Gap] No source";
      
      let priceVarianceScore = null;
      let priceEvidence = priceSource;

      if (quotedPrice !== null && quotedPrice !== undefined && benchmarkPrice !== null) {
        const variance = Math.abs(quotedPrice - benchmarkPrice) / benchmarkPrice;
        // 0% variance = 0, 10% = 3, 20% = 6, 30%+ = 10
        priceVarianceScore = Math.min(10, variance * 30);
        priceEvidence = `${(variance * 100).toFixed(1)}% variance from benchmark at ${priceSource}`;
        totalWeightedScore += riskWeights.price_variance * priceVarianceScore;
        totalWeight += riskWeights.price_variance;
      } else {
        priceEvidence = `[Data Gap] Price not available at ${priceSource}`;
      }

      factors.push({
        factor: "Price variance",
        weight: riskWeights.price_variance,
        subscore: priceVarianceScore,
        evidence: priceEvidence
      });

      // 3. Quality Certification Risk
      let qualityCertScore = null;
      let qualityEvidence = "";

      // Check line items for ISO/API certifications
      const hasISO = doc.line_items?.some((item: any) => 
        item.name?.toLowerCase().includes('iso') || 
        item.name?.toLowerCase().includes('api')
      );

      if (hasISO) {
        qualityCertScore = 0;
        const certItem = doc.line_items.find((item: any) => 
          item.name?.toLowerCase().includes('iso') || 
          item.name?.toLowerCase().includes('api')
        );
        qualityEvidence = `ISO/API certification found at ${certItem?.source || 'document'}`;
      } else {
        qualityCertScore = 8;
        qualityEvidence = `[Data Gap] No ISO/API certification found in line items`;
      }

      totalWeightedScore += riskWeights.quality_cert * qualityCertScore;
      totalWeight += riskWeights.quality_cert;

      factors.push({
        factor: "Quality certification",
        weight: riskWeights.quality_cert,
        subscore: qualityCertScore,
        evidence: qualityEvidence
      });

      // 4. Warranty Terms Risk
      const warrantyMonths = doc.terms?.warranty_months;
      let warrantyScore = null;
      let warrantyEvidence = doc.terms?.source || "[Data Gap] No source";

      if (warrantyMonths !== null && warrantyMonths !== undefined) {
        // Shorter warranty = higher risk
        // 24+ months = 0, 12-23 = 3-5, 6-11 = 6-8, <6 = 9-10
        if (warrantyMonths >= 24) {
          warrantyScore = 0;
        } else if (warrantyMonths >= 12) {
          warrantyScore = 3 + ((24 - warrantyMonths) / 12) * 2;
        } else if (warrantyMonths >= 6) {
          warrantyScore = 6 + ((12 - warrantyMonths) / 6) * 2;
        } else {
          warrantyScore = Math.min(10, 9 + (6 - warrantyMonths) / 6);
        }
        warrantyEvidence = `${warrantyMonths} months warranty at ${doc.terms?.source}`;
        totalWeightedScore += riskWeights.warranty_terms * warrantyScore;
        totalWeight += riskWeights.warranty_terms;
      } else {
        warrantyEvidence = `[Data Gap] Warranty not specified at ${doc.terms?.source}`;
      }

      factors.push({
        factor: "Warranty terms",
        weight: riskWeights.warranty_terms,
        subscore: warrantyScore,
        evidence: warrantyEvidence
      });

      // 5. Payment Terms Risk
      const paymentTerms = doc.terms?.payment_terms || "";
      let paymentScore = null;
      let paymentEvidence = doc.terms?.source || "[Data Gap] No source";

      if (paymentTerms) {
        // Parse payment terms for risk indicators
        const hasAdvancePayment = /advance|upfront|prepay/i.test(paymentTerms);
        const hasNet60Plus = /net\s*[6-9]\d|net\s*\d{3}/i.test(paymentTerms);
        const hasNet30 = /net\s*30/i.test(paymentTerms);
        
        if (hasAdvancePayment) {
          paymentScore = 8; // High risk - advance payment
        } else if (hasNet60Plus) {
          paymentScore = 5; // Medium risk - long payment terms
        } else if (hasNet30) {
          paymentScore = 2; // Low risk - standard terms
        } else {
          paymentScore = 4; // Moderate risk - unclear terms
        }
        
        paymentEvidence = `"${paymentTerms}" at ${doc.terms?.source}`;
        totalWeightedScore += riskWeights.payment_terms * paymentScore;
        totalWeight += riskWeights.payment_terms;
      } else {
        paymentEvidence = `[Data Gap] Payment terms not specified at ${doc.terms?.source}`;
      }

      factors.push({
        factor: "Payment terms",
        weight: riskWeights.payment_terms,
        subscore: paymentScore,
        evidence: paymentEvidence
      });

      // 6. Complexity Risk
      let complexityScore = null;
      let complexityEvidence = "";

      const itemCount = doc.line_items?.length || 0;
      const hasMultiplePhases = doc.line_items?.some((item: any) => 
        /phase|stage|milestone/i.test(item.name || "")
      );
      const hasMultipleDeliveries = doc.line_items?.some((item: any) => 
        /delivery|shipment|batch/i.test(item.name || "")
      );

      if (itemCount === 0) {
        complexityEvidence = "[Data Gap] No line items found";
      } else {
        complexityScore = 0;
        const complexityFactors = [];

        if (itemCount > 50) {
          complexityScore += 5;
          complexityFactors.push(`${itemCount} line items`);
        } else if (itemCount > 20) {
          complexityScore += 3;
          complexityFactors.push(`${itemCount} line items`);
        }

        if (hasMultiplePhases) {
          complexityScore += 3;
          complexityFactors.push("multi-phase delivery");
        }

        if (hasMultipleDeliveries) {
          complexityScore += 2;
          complexityFactors.push("multiple deliveries");
        }

        complexityScore = Math.min(10, complexityScore);
        complexityEvidence = complexityFactors.length > 0 
          ? `Complexity from: ${complexityFactors.join(', ')}`
          : `${itemCount} line items, standard delivery`;
        
        totalWeightedScore += riskWeights.complexity * complexityScore;
        totalWeight += riskWeights.complexity;
      }

      factors.push({
        factor: "Complexity",
        weight: riskWeights.complexity,
        subscore: complexityScore,
        evidence: complexityEvidence
      });

      // Calculate final risk score (0-100)
      const riskScore = totalWeight > 0 
        ? Math.round(10 * totalWeightedScore)
        : null;

      // Generate AI explanation
      const explanationPrompt = `Generate a concise risk explanation for this supplier:

Supplier: ${supplier}
Risk Score: ${riskScore}/100

Risk Factors:
${factors.map(f => `- ${f.factor}: ${f.subscore !== null ? f.subscore.toFixed(1) : 'N/A'}/10 (weight ${f.weight}) - ${f.evidence}`).join('\n')}

Provide:
1. A 1-2 sentence explanation of why this risk score was calculated
2. A "what_lowers_risk" suggestion with specific numeric thresholds

Return JSON:
{
  "explanation": "...",
  "what_lowers_risk": "..."
}`;

      let explanation = `Risk ${riskScore}/100 based on available data`;
      let whatLowersRisk = "More complete data needed for accurate risk reduction recommendations";

      try {
        const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${lovableApiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model: 'google/gemini-2.5-flash',
            messages: [
              { 
                role: 'system', 
                content: 'You are a procurement risk analyst. Provide concise, factual explanations. Return only valid JSON.' 
              },
              { role: 'user', content: explanationPrompt }
            ]
          })
        });

        if (aiResponse.ok) {
          const aiData = await aiResponse.json();
          const content = aiData.choices[0]?.message?.content;
          if (content) {
            const jsonMatch = content.match(/\{[\s\S]*\}/);
            if (jsonMatch) {
              const parsed = JSON.parse(jsonMatch[0]);
              explanation = parsed.explanation || explanation;
              whatLowersRisk = parsed.what_lowers_risk || whatLowersRisk;
            }
          }
        }
      } catch (aiError) {
        console.error('[SCORE] AI explanation error:', aiError);
      }

      scoredSuppliers.push({
        supplier,
        doc_id: doc.doc_id,
        risk_score: riskScore,
        factors,
        explanation,
        what_lowers_risk: whatLowersRisk,
        metadata: {
          total_weight: totalWeight,
          missing_factors: factors.filter(f => f.subscore === null).length
        }
      });

      console.log(`[SCORE] ${supplier}: Risk score ${riskScore}/100`);
    }

    const response = {
      suppliers: scoredSuppliers,
      weights_used: riskWeights,
      benchmark_price: benchmarkPrice,
      metadata: {
        suppliers_scored: scoredSuppliers.length,
        timestamp: new Date().toISOString()
      }
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[SCORE] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Risk scoring failed',
        suppliers: []
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
