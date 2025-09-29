import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from "https://esm.sh/@supabase/supabase-js@2"

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
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

    if (req.method === 'GET') {
      const url = new URL(req.url)
      const jobId = url.pathname.split('/').pop()

      if (!jobId) {
        return new Response(
          JSON.stringify({ error: 'Job ID required' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Get processing job status
      const { data: job, error: jobError } = await supabase
        .from('processing_jobs')
        .select(`
          *,
          documents!inner(
            id,
            filename,
            user_id
          )
        `)
        .eq('document_id', jobId)
        .eq('documents.user_id', user.id)
        .single()

      if (jobError || !job) {
        return new Response(
          JSON.stringify({ error: 'Job not found' }),
          { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // If job is not completed, return status
      if (job.job_status !== 'completed') {
        return new Response(
          JSON.stringify({
            job_id: jobId,
            status: job.job_status,
            progress: job.progress,
            error_message: job.error_message
          }),
          {
            status: 200,
            headers: { ...corsHeaders, 'Content-Type': 'application/json' }
          }
        )
      }

      // Get comprehensive results for completed job
      const { data: vendorOffers, error: offersError } = await supabase
        .from('vendor_offers')
        .select(`
          *,
          tco_calculations(*),
          risk_assessments(*),
          lead_time_analysis(*)
        `)
        .eq('document_id', jobId)

      if (offersError) {
        console.error('Offers error:', offersError)
        return new Response(
          JSON.stringify({ error: 'Failed to retrieve results' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Format results for frontend consumption
      const formattedResults = vendorOffers?.map(offer => ({
        id: offer.id,
        vendorName: offer.vendor_name,
        quotedPrice: parseFloat(offer.quoted_price),
        calculatedTCO: offer.tco_calculations?.[0]?.calculated_tco ? 
          parseFloat(offer.tco_calculations[0].calculated_tco) : 
          parseFloat(offer.quoted_price),
        leadTime: offer.lead_time_analysis?.[0]?.estimated_lead_time || 14,
        riskScore: offer.risk_assessments?.[0]?.risk_score || 0,
        items: offer.items_count || 0,
        currency: offer.currency || 'USD',
        riskFactors: offer.risk_assessments?.[0]?.risk_factors || [],
        tcoBreakdown: offer.tco_calculations?.[0]?.breakdown || {
          quotedPrice: parseFloat(offer.quoted_price),
          shippingCosts: 0,
          handlingFees: 0,
          riskPremium: 0,
          qualityAdjustment: 0
        }
      })) || []

      return new Response(
        JSON.stringify({
          job_id: jobId,
          status: 'completed',
          results: formattedResults,
          summary: {
            totalVendors: formattedResults.length,
            recommendedVendor: formattedResults.length > 0 ? 
              formattedResults.reduce((prev, current) => 
                current.calculatedTCO < prev.calculatedTCO ? current : prev
              ).vendorName : null,
            avgTCO: formattedResults.length > 0 ? 
              formattedResults.reduce((sum, vendor) => sum + vendor.calculatedTCO, 0) / formattedResults.length : 0,
            highRiskCount: formattedResults.filter(v => v.riskScore >= 70).length
          }
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