import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ActionItemRequestSchema = z.object({
  document_id: z.string().uuid().optional(),
  workflow_id: z.string().uuid().optional(),
  vendor_offer_ids: z.array(z.string().uuid()).optional(),
  context: z.string().optional(),
})

interface ActionItem {
  label: 'Action' | 'Follow-Up' | 'Review'
  task: string
  priority: 'High' | 'Medium' | 'Low'
  assignee?: string
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const lovableApiKey = Deno.env.get('LOVABLE_API_KEY')
    if (!lovableApiKey) {
      return new Response(
        JSON.stringify({ error: 'LOVABLE_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const supabaseUrl = Deno.env.get('SUPABASE_URL')!
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
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

    const requestBody = await req.json()
    const validation = ActionItemRequestSchema.safeParse(requestBody)
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: validation.error.errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { document_id, workflow_id, vendor_offer_ids, context } = validation.data

    console.log('Generating action items for:', { document_id, workflow_id, vendor_offer_ids })

    // Gather procurement data
    let procurementContext = ''

    // Get document info
    if (document_id) {
      const { data: document } = await supabase
        .from('documents')
        .select('filename, upload_status')
        .eq('id', document_id)
        .eq('user_id', user.id)
        .single()
      
      if (document) {
        procurementContext += `Document: ${document.filename} (Status: ${document.upload_status})\n`
      }
    }

    // Get workflow/approval state
    if (workflow_id) {
      const { data: workflow } = await supabase
        .from('approval_workflows')
        .select('supplier_name, current_state, approval_chain')
        .eq('id', workflow_id)
        .single()
      
      if (workflow) {
        procurementContext += `Supplier: ${workflow.supplier_name}\n`
        procurementContext += `Approval State: ${workflow.current_state}\n`
        procurementContext += `Approval Chain: ${JSON.stringify(workflow.approval_chain)}\n`

        // Get latest audit logs
        const { data: auditLogs } = await supabase
          .from('approval_audit_logs')
          .select('action, actor_name, comment, new_state, created_at')
          .eq('workflow_id', workflow_id)
          .order('created_at', { ascending: false })
          .limit(3)
        
        if (auditLogs && auditLogs.length > 0) {
          procurementContext += '\nRecent Activity:\n'
          auditLogs.forEach(log => {
            procurementContext += `- ${log.actor_name} ${log.action} (${log.new_state})${log.comment ? ': ' + log.comment : ''}\n`
          })
        }
      }
    }

    // Get vendor offers and comparisons
    if (vendor_offer_ids && vendor_offer_ids.length > 0) {
      const { data: offers } = await supabase
        .from('vendor_offers')
        .select(`
          vendor_name,
          quoted_price,
          currency,
          items_count,
          extracted_data,
          risk_assessments(risk_score, risk_factors),
          tco_calculations(calculated_tco, breakdown),
          lead_time_analysis(estimated_lead_time, confidence_level, factors)
        `)
        .in('id', vendor_offer_ids)
      
      if (offers && offers.length > 0) {
        procurementContext += '\nVendor Offers:\n'
        offers.forEach((offer: any) => {
          procurementContext += `\n${offer.vendor_name}:\n`
          procurementContext += `  Price: ${offer.currency} ${offer.quoted_price}\n`
          procurementContext += `  Items: ${offer.items_count}\n`
          
          if (offer.risk_assessments && offer.risk_assessments.length > 0) {
            const risk = offer.risk_assessments[0]
            procurementContext += `  Risk Score: ${risk.risk_score}/100\n`
            procurementContext += `  Risk Factors: ${JSON.stringify(risk.risk_factors)}\n`
          }
          
          if (offer.tco_calculations && offer.tco_calculations.length > 0) {
            const tco = offer.tco_calculations[0]
            procurementContext += `  Total Cost of Ownership: ${tco.calculated_tco}\n`
          }
          
          if (offer.lead_time_analysis && offer.lead_time_analysis.length > 0) {
            const lead = offer.lead_time_analysis[0]
            procurementContext += `  Estimated Lead Time: ${lead.estimated_lead_time} days\n`
          }
        })
      }
    }

    // Add user-provided context
    if (context) {
      procurementContext += `\nAdditional Context:\n${context}\n`
    }

    console.log('Procurement context prepared:', procurementContext.substring(0, 500) + '...')

    // Call Lovable AI with tool calling for structured output
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
            content: `You are the Action Item Generator for ClarityChain AI, a procurement analysis platform.

Your task is to analyze procurement data and generate 3-5 clear, concrete next steps for the procurement team.

Label each item as:
- [Action] - Direct action needed now
- [Follow-Up] - Information gathering or verification
- [Review] - Decision or approval needed

Assign priority (High/Medium/Low) based on urgency and impact.
Suggest assignees when clear (e.g., "CFO", "Procurement Lead", "Supplier Manager").

Focus on practical, actionable tasks that move the procurement process forward.`
          },
          {
            role: 'user',
            content: `Based on the following procurement data, generate actionable next steps:\n\n${procurementContext}`
          }
        ],
        tools: [
          {
            type: 'function',
            function: {
              name: 'generate_action_items',
              description: 'Generate 3-5 actionable next steps for the procurement team',
              parameters: {
                type: 'object',
                properties: {
                  actions: {
                    type: 'array',
                    items: {
                      type: 'object',
                      properties: {
                        label: {
                          type: 'string',
                          enum: ['Action', 'Follow-Up', 'Review']
                        },
                        task: {
                          type: 'string',
                          description: 'Clear, concrete description of the task'
                        },
                        priority: {
                          type: 'string',
                          enum: ['High', 'Medium', 'Low']
                        },
                        assignee: {
                          type: 'string',
                          description: 'Suggested role or person to handle this task'
                        }
                      },
                      required: ['label', 'task', 'priority'],
                      additionalProperties: false
                    },
                    minItems: 3,
                    maxItems: 5
                  }
                },
                required: ['actions'],
                additionalProperties: false
              }
            }
          }
        ],
        tool_choice: { type: 'function', function: { name: 'generate_action_items' } }
      }),
    })

    if (!aiResponse.ok) {
      const errorText = await aiResponse.text()
      console.error('AI API error:', aiResponse.status, errorText)
      
      if (aiResponse.status === 429) {
        return new Response(
          JSON.stringify({ error: 'Rate limit exceeded. Please try again later.' }),
          { status: 429, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      if (aiResponse.status === 402) {
        return new Response(
          JSON.stringify({ error: 'AI credits exhausted. Please add credits to your workspace.' }),
          { status: 402, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
      
      return new Response(
        JSON.stringify({ error: 'AI API error', details: errorText }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const aiData = await aiResponse.json()
    console.log('AI response received:', JSON.stringify(aiData))

    // Extract action items from tool call
    const toolCall = aiData.choices?.[0]?.message?.tool_calls?.[0]
    if (!toolCall || toolCall.function.name !== 'generate_action_items') {
      return new Response(
        JSON.stringify({ error: 'Failed to generate action items' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const actionItems = JSON.parse(toolCall.function.arguments)
    console.log('Generated action items:', actionItems)

    return new Response(
      JSON.stringify({
        success: true,
        actions: actionItems.actions,
        context_used: {
          document_id,
          workflow_id,
          vendor_offers_count: vendor_offer_ids?.length || 0
        }
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error generating action items:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to generate action items',
        details: error instanceof Error ? error.stack : undefined
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})
