import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

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

    const { question, context_snippets, metadata } = await req.json()

    if (!question || typeof question !== 'string') {
      return new Response(
        JSON.stringify({ error: 'question (string) is required' }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Processing chat question:', question)
    console.log('Context snippets:', context_snippets?.length || 0)
    console.log('Metadata:', metadata)

    // Build the chat prompt with RAG context
    const systemPrompt = `You are an interactive AI analyst helping users understand procurement reports.

Instructions:
1. Use ONLY the retrieved context provided. Do NOT invent data.
2. If multiple suppliers are mentioned, always present side-by-side comparisons.
3. If the question asks "why" or "how", respond with clear reasoning tied to data points and cite the source.
4. Format outputs as concise markdown, using:
   - **Bold** for key insights
   - Bulleted lists for comparisons
   - "Source:" line for references
5. End every answer with a one-line executive takeaway in italics, e.g.:
   "_Overall, Supplier B presents the lowest delivery risk due to shorter lead times and proven past reliability._"

Example output format:
**Supplier Comparison:**
- Aker: 2400m delivery, 46-week lead, risk 8/10 (delays + high price variance)
- TechnipFMC: 2400m delivery, 34-week lead, risk 6/10 (moderate reliability)

**Source:** Aker_Offer.pdf p2, TechnipFMC_Offer.pdf p3

_Overall, TechnipFMC offers better delivery stability._

If you don't have context to answer the question, say: "I don't have enough information in the current analysis to answer this question. Please ensure relevant documents have been uploaded and processed."`

    // Prepare context for the assistant
    let contextText = ''
    if (context_snippets && Array.isArray(context_snippets) && context_snippets.length > 0) {
      contextText = 'Retrieved Context:\n\n'
      context_snippets.forEach((snippet: any, index: number) => {
        contextText += `[${index + 1}] Source: ${snippet.source}\n`
        contextText += `${snippet.snippet}\n\n`
      })
    } else {
      contextText = 'No context snippets provided. Limited information available.'
    }

    // Add metadata if available
    if (metadata) {
      contextText += '\nMetadata:\n'
      contextText += JSON.stringify(metadata, null, 2)
    }

    const userPrompt = `Context from knowledge base:
${contextText}

User's question: ${question}

Provide a clear, concise answer using ONLY the context above. Format your response in markdown with proper structure, comparisons, source citations, and an executive takeaway.`

    console.log('Calling Lovable AI for chat response')

    const aiResponse = await fetch('https://ai.gateway.lovable.dev/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${lovableApiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'google/gemini-2.5-flash',
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt }
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
      
      throw new Error(`AI chat response failed: ${aiResponse.status}`)
    }

    const aiResult = await aiResponse.json()
    const assistantResponse = aiResult.choices[0]?.message?.content

    if (!assistantResponse) {
      throw new Error('No response generated from AI')
    }

    console.log('Chat response generated successfully')

    return new Response(
      JSON.stringify({ 
        success: true,
        question: question,
        answer: assistantResponse,
        context_used: context_snippets?.length || 0,
        timestamp: new Date().toISOString()
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Chat assistant error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Chat assistant failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
