import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// Mock document analysis functions (replace with actual integrations)
class OfferComparator {
  async calculateTCO(offerData: any): Promise<{ tco: number; breakdown: any }> {
    const basePrice = offerData.quoted_price || 0
    const shippingCosts = basePrice * 0.05 // 5% shipping
    const handlingFees = Math.min(basePrice * 0.02, 500) // 2% or max $500
    const riskPremium = offerData.risk_score ? (offerData.risk_score / 100) * basePrice * 0.1 : 0
    const qualityAdjustment = basePrice * 0.03 // 3% quality factor

    const tco = basePrice + shippingCosts + handlingFees + riskPremium + qualityAdjustment

    return {
      tco: Math.round(tco * 100) / 100,
      breakdown: {
        quotedPrice: basePrice,
        shippingCosts: Math.round(shippingCosts * 100) / 100,
        handlingFees: Math.round(handlingFees * 100) / 100,
        riskPremium: Math.round(riskPremium * 100) / 100,
        qualityAdjustment: Math.round(qualityAdjustment * 100) / 100
      }
    }
  }

  async scoreRisk(offerData: any): Promise<{ score: number; factors: string[] }> {
    let riskScore = 0
    const riskFactors: string[] = []

    // Check certifications
    const certifications = offerData.certifications || []
    if (!certifications.includes('ISO 9001')) {
      riskScore += 25
      riskFactors.push('Missing ISO 9001 certification')
    }

    // Check delivery history
    if (offerData.delivery_history === 'late') {
      riskScore += 30
      riskFactors.push('History of late deliveries')
    }

    // Check price discrepancy
    const quotedTotal = offerData.quoted_total || 0
    const lineItemTotal = offerData.line_item_total || 0
    if (Math.abs(quotedTotal - lineItemTotal) > quotedTotal * 0.05) {
      riskScore += 20
      riskFactors.push('Significant price discrepancy detected')
    }

    // Geographic risk (mock)
    if (offerData.location && ['high-risk-region'].includes(offerData.location)) {
      riskScore += 15
      riskFactors.push('Located in high-risk geographic region')
    }

    return {
      score: Math.min(riskScore, 100),
      factors: riskFactors
    }
  }

  async analyzeLeadTime(offerData: any): Promise<{ estimatedDays: number; factors: string[] }> {
    let baseDays = offerData.quoted_lead_time || 14
    const factors: string[] = []

    // Adjust based on risk factors
    if (offerData.delivery_history === 'late') {
      baseDays += 7
      factors.push('Historical delivery delays')
    }

    if (!offerData.certifications?.includes('ISO 9001')) {
      baseDays += 3
      factors.push('Quality certification requirements')
    }

    return {
      estimatedDays: Math.max(baseDays, 1),
      factors
    }
  }
}

serve(async (req) => {
  // Handle CORS preflight requests
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    )

    // Get the authorization header
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization header required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Verify the user
    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid authorization token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    if (req.method === 'POST') {
      const { document_id } = await req.json()

      if (!document_id) {
        return new Response(
          JSON.stringify({ error: 'Document ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get document
      const { data: document, error: docError } = await supabase
        .from('documents')
        .select('*')
        .eq('id', document_id)
        .eq('user_id', user.id)
        .single()

      if (docError || !document) {
        return new Response(
          JSON.stringify({ error: 'Document not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Update job status to processing
      await supabase
        .from('processing_jobs')
        .update({ job_status: 'processing', progress: 10 })
        .eq('document_id', document_id)

      // Mock document processing - simulate extracted data
      const mockVendorData = {
        vendor_name: `Vendor ${Math.floor(Math.random() * 1000)}`,
        quoted_price: Math.floor(Math.random() * 20000) + 5000,
        quoted_total: 0,
        line_item_total: 0,
        items_count: Math.floor(Math.random() * 50) + 10,
        certifications: Math.random() > 0.5 ? ['ISO 9001'] : [],
        delivery_history: Math.random() > 0.7 ? 'late' : 'on-time',
        quoted_lead_time: Math.floor(Math.random() * 30) + 5,
        location: Math.random() > 0.8 ? 'high-risk-region' : 'standard-region'
      }

      mockVendorData.quoted_total = mockVendorData.quoted_price
      mockVendorData.line_item_total = mockVendorData.quoted_price * (0.95 + Math.random() * 0.1)

      // Update progress
      await supabase
        .from('processing_jobs')
        .update({ progress: 40 })
        .eq('document_id', document_id)

      // Create vendor offer
      const { data: vendorOffer, error: offerError } = await supabase
        .from('vendor_offers')
        .insert({
          document_id: document_id,
          vendor_name: mockVendorData.vendor_name,
          quoted_price: mockVendorData.quoted_price,
          currency: 'USD',
          items_count: mockVendorData.items_count,
          extracted_data: mockVendorData
        })
        .select()
        .single()

      if (offerError) {
        console.error('Vendor offer error:', offerError)
        await supabase
          .from('processing_jobs')
          .update({ job_status: 'failed', error_message: 'Failed to create vendor offer' })
          .eq('document_id', document_id)
        
        return new Response(
          JSON.stringify({ error: 'Failed to process vendor data' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Update progress
      await supabase
        .from('processing_jobs')
        .update({ progress: 60 })
        .eq('document_id', document_id)

      // Initialize analyzer
      const analyzer = new OfferComparator()

      // Calculate risk score
      const riskResult = await analyzer.scoreRisk(mockVendorData)
      const { error: riskError } = await supabase
        .from('risk_assessments')
        .insert({
          vendor_offer_id: vendorOffer.id,
          risk_score: riskResult.score,
          risk_factors: riskResult.factors,
          assessment_data: { method: 'automated', version: '1.0' }
        })

      if (riskError) {
        console.error('Risk assessment error:', riskError)
      }

      // Update progress
      await supabase
        .from('processing_jobs')
        .update({ progress: 80 })
        .eq('document_id', document_id)

      // Calculate TCO (with risk score)
      const tcoResult = await analyzer.calculateTCO({ 
        ...mockVendorData, 
        risk_score: riskResult.score 
      })
      
      const { error: tcoError } = await supabase
        .from('tco_calculations')
        .insert({
          vendor_offer_id: vendorOffer.id,
          calculated_tco: tcoResult.tco,
          breakdown: tcoResult.breakdown,
          calculation_method: 'automated'
        })

      if (tcoError) {
        console.error('TCO calculation error:', tcoError)
      }

      // Analyze lead time
      const leadTimeResult = await analyzer.analyzeLeadTime(mockVendorData)
      const { error: leadTimeError } = await supabase
        .from('lead_time_analysis')
        .insert({
          vendor_offer_id: vendorOffer.id,
          estimated_lead_time: leadTimeResult.estimatedDays,
          confidence_level: 0.85,
          factors: leadTimeResult.factors
        })

      if (leadTimeError) {
        console.error('Lead time analysis error:', leadTimeError)
      }

      // Complete the job
      const { error: finalError } = await supabase
        .from('processing_jobs')
        .update({ 
          job_status: 'completed', 
          progress: 100,
          result_data: {
            vendor_offer_id: vendorOffer.id,
            processing_complete: true
          }
        })
        .eq('document_id', document_id)

      if (finalError) {
        console.error('Job completion error:', finalError)
      }

      return new Response(
        JSON.stringify({
          job_id: document_id,
          status: 'completed',
          vendor_offer_id: vendorOffer.id,
          message: 'Document processed successfully'
        }),
        {
          status: 200,
          headers: { ...corsHeaders, 'Content-Type': 'application/json' }
        }
      )
    }

    return new Response(
      JSON.stringify({ error: 'Method not allowed' }),
      { status: 405, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )

  } catch (error) {
    console.error('Function error:', error)
    return new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    )
  }
})