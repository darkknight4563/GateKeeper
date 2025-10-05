import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import React from 'https://esm.sh/react@18.3.1'
import { Resend } from 'https://esm.sh/resend@4.0.0'
import { renderAsync } from 'https://esm.sh/@react-email/components@0.0.22'
import { ApprovalNotificationEmail } from './_templates/approval-notification.tsx'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const NotificationRequestSchema = z.object({
  workflow_id: z.string().uuid(),
  recipient_emails: z.array(z.string().email()).min(1),
  include_teams: z.boolean().optional(),
  teams_webhook_url: z.string().url().optional(),
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
    const resendApiKey = Deno.env.get('RESEND_API_KEY')
    if (!resendApiKey) {
      return new Response(
        JSON.stringify({ error: 'RESEND_API_KEY not configured' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const resend = new Resend(resendApiKey)
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
    const validation = NotificationRequestSchema.safeParse(requestBody)
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: validation.error.errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { workflow_id, recipient_emails, include_teams, teams_webhook_url } = validation.data

    console.log('Sending approval notification for workflow:', workflow_id)

    // Get workflow details
    const { data: workflow, error: workflowError } = await supabase
      .from('approval_workflows')
      .select('*')
      .eq('id', workflow_id)
      .single()

    if (workflowError || !workflow) {
      return new Response(
        JSON.stringify({ error: 'Workflow not found' }),
        { status: 404, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Get latest audit log entry
    const { data: latestAudit } = await supabase
      .from('approval_audit_logs')
      .select('*')
      .eq('workflow_id', workflow_id)
      .order('created_at', { ascending: false })
      .limit(1)
      .single()

    // Get document details
    const { data: document } = await supabase
      .from('documents')
      .select('filename')
      .eq('id', workflow.document_id)
      .single()

    const documentTitle = document?.filename || 'Procurement Document'
    const actorName = latestAudit?.actor_name || 'System'
    const previousState = latestAudit?.previous_state
    const comment = latestAudit?.comment
    const nextAction = getNextAction(workflow.current_state)
    const reportUrl = `${supabaseUrl.replace('supabase.co', 'lovable.app')}/report/${workflow_id}`

    // Render email HTML
    const emailHtml = await renderAsync(
      React.createElement(ApprovalNotificationEmail, {
        document_title: documentTitle,
        supplier_name: workflow.supplier_name,
        current_state: workflow.current_state,
        previous_state: previousState,
        next_approver: undefined, // Can be enhanced later
        actor_name: actorName,
        comment: comment,
        next_action: nextAction,
        report_url: reportUrl,
      })
    )

    // Send email via Resend
    const subject = `[ClarityChain AI] ${workflow.supplier_name} – Status ${workflow.current_state.toUpperCase()}`
    
    const { data: emailResult, error: emailError } = await resend.emails.send({
      from: 'ClarityChain AI <notifications@claritychain.ai>',
      to: recipient_emails,
      subject: subject,
      html: emailHtml,
    })

    if (emailError) {
      console.error('Failed to send email:', emailError)
      return new Response(
        JSON.stringify({ error: 'Failed to send email', details: emailError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    console.log('Email sent successfully:', emailResult)

    // Send Teams notification if requested
    let teamsResult = null
    if (include_teams && teams_webhook_url) {
      const teamsPayload = createTeamsAdaptiveCard({
        document_title: documentTitle,
        supplier_name: workflow.supplier_name,
        current_state: workflow.current_state,
        previous_state: previousState,
        actor_name: actorName,
        comment: comment,
        next_action: nextAction,
        report_url: reportUrl,
      })

      try {
        const teamsResponse = await fetch(teams_webhook_url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(teamsPayload),
        })

        if (teamsResponse.ok) {
          teamsResult = { success: true }
          console.log('Teams notification sent successfully')
        } else {
          console.error('Failed to send Teams notification:', await teamsResponse.text())
        }
      } catch (teamsError) {
        console.error('Teams notification error:', teamsError)
      }
    }

    return new Response(
      JSON.stringify({ 
        success: true,
        email_sent: true,
        email_id: emailResult?.id,
        teams_sent: teamsResult?.success || false,
        recipients: recipient_emails.length
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Notification error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Notification failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})

function getNextAction(state: string): string {
  const actions: Record<string, string> = {
    pending: 'Awaiting review by approval team',
    approved: 'Workflow completed. Proceed with procurement.',
    rejected: 'Review rejection reasons and address concerns before resubmission.',
    revised: 'Supplier to provide revised documentation based on feedback.',
  }
  return actions[state] || 'Review current status and take appropriate action.'
}

function createTeamsAdaptiveCard(data: {
  document_title: string
  supplier_name: string
  current_state: string
  previous_state?: string
  actor_name: string
  comment?: string
  next_action: string
  report_url: string
}) {
  const stateColors: Record<string, string> = {
    pending: 'warning',
    approved: 'good',
    rejected: 'attention',
    revised: 'accent',
  }

  return {
    type: 'message',
    attachments: [
      {
        contentType: 'application/vnd.microsoft.card.adaptive',
        content: {
          $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
          type: 'AdaptiveCard',
          version: '1.4',
          body: [
            {
              type: 'TextBlock',
              text: 'ClarityChain AI',
              weight: 'bolder',
              size: 'large',
            },
            {
              type: 'TextBlock',
              text: data.supplier_name,
              size: 'medium',
              weight: 'bolder',
              spacing: 'medium',
            },
            {
              type: 'FactSet',
              facts: [
                {
                  title: 'Document:',
                  value: data.document_title,
                },
                {
                  title: 'Status:',
                  value: data.current_state.toUpperCase(),
                },
                ...(data.previous_state
                  ? [
                      {
                        title: 'State Change:',
                        value: `${data.previous_state} → ${data.current_state}`,
                      },
                    ]
                  : []),
                {
                  title: 'Updated by:',
                  value: data.actor_name,
                },
              ],
            },
            ...(data.comment
              ? [
                  {
                    type: 'TextBlock',
                    text: 'Comment:',
                    weight: 'bolder',
                    spacing: 'medium',
                  },
                  {
                    type: 'TextBlock',
                    text: data.comment,
                    isSubtle: true,
                    wrap: true,
                  },
                ]
              : []),
            {
              type: 'TextBlock',
              text: 'Next Step:',
              weight: 'bolder',
              spacing: 'medium',
            },
            {
              type: 'TextBlock',
              text: data.next_action,
              wrap: true,
            },
          ],
          actions: [
            {
              type: 'Action.OpenUrl',
              title: 'Open in ClarityChain',
              url: data.report_url,
            },
          ],
        },
      },
    ],
  }
}
