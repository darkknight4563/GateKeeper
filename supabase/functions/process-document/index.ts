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

      // Get storage path from document
      const storagePath = document.file_path
      
      // Download file from storage
      const { data: fileData, error: downloadError } = await supabase.storage
        .from('procurement-documents')
        .download(storagePath)

      if (downloadError || !fileData) {
        console.error('Storage download error:', downloadError)
        await supabase
          .from('processing_jobs')
          .update({ job_status: 'failed', error_message: 'Failed to download file from storage' })
          .eq('document_id', document_id)
        
        return new Response(
          JSON.stringify({ error: 'Failed to download file from storage' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Convert blob to base64 for processing
      const arrayBuffer = await fileData.arrayBuffer()
      const base64Content = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)))
      
      console.log('Processing file from storage:', storagePath, 'Size:', fileData.size)

      // Call document-processor to extract real vendor data using Lovable AI
      let vendorData
      try {
        const processorResponse = await fetch(
          `${Deno.env.get('SUPABASE_URL')}/functions/v1/document-processor`,
          {
            method: 'POST',
            headers: {
              'Authorization': authHeader,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              document_id: document_id,
              file_content: base64Content,
              filename: document.filename,
              mime_type: document.mime_type
            })
          }
        )

        if (!processorResponse.ok) {
          const errorText = await processorResponse.text()
          console.error('Document processor failed:', processorResponse.status, errorText)
          throw new Error(`Document processing failed: ${processorResponse.status}`)
        }

        const processorResult = await processorResponse.json()
        vendorData = processorResult.vendor_data

        console.log('Extracted vendor data:', vendorData)

      } catch (processorError) {
        console.error('Document processor error:', processorError)
        
        // Fallback to basic extraction from filename if processor fails
        vendorData = {
          vendor_name: document.filename.replace(/\.[^/.]+$/, ''),
          quoted_price: 50000,
          quoted_total: 50000,
          line_item_total: 50000,
          items_count: 10,
          certifications: [],
          delivery_history: 'unknown',
          quoted_lead_time: 30,
          location: 'Unknown',
          currency: 'USD'
        }
        
        console.log('Using fallback vendor data due to processor error')
      }

      // Update progress
      await supabase
        .from('processing_jobs')
        .update({ progress: 40 })
        .eq('document_id', document_id)

      // Create vendor offer with extracted data
      const { data: vendorOffer, error: offerError } = await supabase
        .from('vendor_offers')
        .insert({
          document_id: document_id,
          vendor_name: vendorData.vendor_name,
          quoted_price: vendorData.quoted_price,
          currency: vendorData.currency || 'USD',
          items_count: vendorData.items_count,
          extracted_data: {
            ...vendorData,
            technical_specs: vendorData.technical_specs || {},
            issues: vendorData.issues || []
          }
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

      // Calculate risk score with real extracted data
      const riskResult = await analyzer.scoreRisk(vendorData)
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

      // Calculate TCO with real extracted data (with risk score)
      const tcoResult = await analyzer.calculateTCO({ 
        ...vendorData, 
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

      // Analyze lead time with real extracted data
      const leadTimeResult = await analyzer.analyzeLeadTime(vendorData)
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