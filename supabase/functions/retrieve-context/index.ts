import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ContextSnippetSchema = z.object({
  source: z.string(),
  snippet: z.string(),
  relevance_score: z.number().min(0).max(1).optional(),
})

const ContextRetrievalSchema = z.array(ContextSnippetSchema).max(5)

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')!

    const supabase = createClient(supabaseUrl, supabaseKey)

    const authHeader = req.headers.get('Authorization')
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const token = authHeader.replace('Bearer ', '')
    const { data: { user }, error: authError } = await supabase.auth.getUser(token)
    
    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { query, job_id } = await req.json()

    if (!query || typeof query !== 'string') {
      return new Response(
        JSON.stringify({ error: 'query (string) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Retrieving context for query:', query)
    console.log('Job ID:', job_id)

    // Retrieve all relevant data from knowledge base
    const knowledgeBase: any = {
      vendor_offers: [],
      risk_assessments: [],
      tco_calculations: [],
      lead_time_analyses: [],
      documents: [],
      processing_jobs: []
    }

    // Get user's documents
    const { data: documents } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(10)

    knowledgeBase.documents = documents || []

    // Get vendor offers with related data
    if (knowledgeBase.documents.length > 0) {
      const documentIds = knowledgeBase.documents.map((d: any) => d.id)
      
      const { data: offers } = await supabase
        .from('vendor_offers')
        .select('*')
        .in('document_id', documentIds)
        .order('created_at', { ascending: false })

      knowledgeBase.vendor_offers = offers || []

      // Get risk assessments
      if (knowledgeBase.vendor_offers.length > 0) {
        const offerIds = knowledgeBase.vendor_offers.map((o: any) => o.id)
        
        const { data: risks } = await supabase
          .from('risk_assessments')
          .select('*')
          .in('vendor_offer_id', offerIds)

        knowledgeBase.risk_assessments = risks || []

        // Get TCO calculations
        const { data: tcos } = await supabase
          .from('tco_calculations')
          .select('*')
          .in('vendor_offer_id', offerIds)

        knowledgeBase.tco_calculations = tcos || []

        // Get lead time analyses
        const { data: leadTimes } = await supabase
          .from('lead_time_analysis')
          .select('*')
          .in('vendor_offer_id', offerIds)

        knowledgeBase.lead_time_analyses = leadTimes || []
      }

      // Get processing jobs
      const { data: jobs } = await supabase
        .from('processing_jobs')
        .select('*')
        .in('document_id', documentIds)
        .order('created_at', { ascending: false })
        .limit(5)

      knowledgeBase.processing_jobs = jobs || []
    }

    console.log('Knowledge base retrieved:', {
      documents: knowledgeBase.documents.length,
      vendor_offers: knowledgeBase.vendor_offers.length,
      risk_assessments: knowledgeBase.risk_assessments.length,
      tco_calculations: knowledgeBase.tco_calculations.length,
      lead_time_analyses: knowledgeBase.lead_time_analyses.length,
      processing_jobs: knowledgeBase.processing_jobs.length
    })

    // Create RAG retrieval prompt
    const retrievalPrompt = `You are ClarityChain AI's report analyst.
Retrieve relevant context from the knowledge base that includes:
- Parsed vendor data
- Calculated risk scores
- TCO components
- Uploaded file snippets (PDF/DOCX/XLSX)
- AI-generated comparison summaries

Task:
Given the user query, extract up to 5 highly relevant sections from the stored analysis that directly support an answer.  
Return only text fragments and their sources, formatted as:

[
  {"source": "document_name#location", "snippet": "relevant text excerpt", "relevance_score": 0.0-1.0},
  ...
]

User Query: "${query}"

Available Knowledge Base:
${JSON.stringify(knowledgeBase, null, 2)}

Instructions:
1. Identify the 5 most relevant pieces of information that answer the query
2. Create concise snippets (50-200 words each)
3. Provide precise source attribution
4. Assign relevance scores (0.0-1.0)
5. Return ONLY valid JSON array, no commentary

If no relevant data exists, return an empty array [].`

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
            content: 'You are a context retrieval assistant for RAG. Always return valid JSON array only, no markdown formatting.' 
          },
          { role: 'user', content: retrievalPrompt }
        ],
      }),
    })

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error('Lovable AI error:', aiResponse.status, errorText)
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded, please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'Payment required, please add funds to your Lovable AI workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      throw new Error(`AI context retrieval failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    const retrievalContent = aiResult.choices[0]?.message?.content

    if (!retrievalContent) {
      console.log('No context retrieved from AI')
      return new Response(
        JSON.stringify({ 
          success: true,
          context: [],
          message: 'No relevant context found'
        }),
        { 
          status: 200, 
          headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
        }
      )
    }

    console.log('Raw AI retrieval response:', retrievalContent)

    // Parse and validate the JSON response
    let contextSnippets
    try {
      const jsonMatch = retrievalContent.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
      const jsonStr = jsonMatch ? jsonMatch[1] : retrievalContent
      const parsedData = JSON.parse(jsonStr.trim())
      
      // Validate against schema
      const validationResult = ContextRetrievalSchema.safeParse(parsedData)
      
      if (!validationResult.success) {
        console.warn('Schema validation failed:', validationResult.error.errors)
        contextSnippets = Array.isArray(parsedData) ? parsedData.slice(0, 5) : []
      } else {
        contextSnippets = validationResult.data
      }
      
    } catch (parseError) {
      console.error('JSON parse error:', parseError, 'Content:', retrievalContent)
      contextSnippets = []
    }

    console.log('Context retrieval result:', contextSnippets)

    return new Response(
      JSON.stringify({ 
        success: true,
        query: query,
        context: contextSnippets,
        knowledge_base_stats: {
          documents_count: knowledgeBase.documents.length,
          vendor_offers_count: knowledgeBase.vendor_offers.length,
          risk_assessments_count: knowledgeBase.risk_assessments.length,
          tco_calculations_count: knowledgeBase.tco_calculations.length
        }
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Context retrieval error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Context retrieval failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
