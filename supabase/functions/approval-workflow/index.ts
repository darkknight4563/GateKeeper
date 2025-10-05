import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ApprovalActionSchema = z.enum(['approve', 'reject', 'request_revision', 'comment'])
const ApprovalStateSchema = z.enum(['pending', 'approved', 'rejected', 'revised'])
const UserRoleSchema = z.enum(['analyst', 'manager', 'director', 'admin'])

const WorkflowRequestSchema = z.object({
  workflow_id: z.string().uuid(),
  action: ApprovalActionSchema,
  comment: z.string().optional(),
  user_role: UserRoleSchema.optional(),
})

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders })
  }

  try {
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
    const validation = WorkflowRequestSchema.safeParse(requestBody)
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: validation.error.errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { workflow_id, action, comment, user_role } = validation.data

    console.log('Processing approval workflow action:', { workflow_id, action, user_id: user.id })

    // Get current workflow
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

    const previousState = workflow.current_state
    let newState: string = previousState
    let nextAction = ''

    // Determine new state based on action
    switch (action) {
      case 'approve':
        newState = 'approved'
        nextAction = 'Workflow completed. No further action required.'
        break
      case 'reject':
        newState = 'rejected'
        nextAction = 'Review rejection reasons and address concerns.'
        break
      case 'request_revision':
        newState = 'revised'
        nextAction = 'Supplier to provide revised documentation.'
        break
      case 'comment':
        newState = previousState // No state change for comments
        nextAction = 'Review comment and take appropriate action.'
        break
    }

    const timestamp = new Date().toISOString()
    const userName = user.email || 'Unknown User'
    
    // Create digital signature (SHA256 hash of actor + timestamp + action)
    const signatureData = `${user.id}:${timestamp}:${action}:${workflow_id}`
    const encoder = new TextEncoder()
    const data = encoder.encode(signatureData)
    const hashBuffer = await crypto.subtle.digest('SHA-256', data)
    const hashArray = Array.from(new Uint8Array(hashBuffer))
    const digitalSignature = hashArray.map(b => b.toString(16).padStart(2, '0')).join('')

    // Create audit entry
    const auditEntry = {
      workflow_id: workflow_id,
      actor_id: user.id,
      actor_name: userName,
      actor_role: user_role || 'analyst',
      previous_state: previousState,
      new_state: newState,
      action: action,
      comment: comment || null,
      digital_signature: digitalSignature,
      metadata: {
        timestamp: timestamp,
        supplier_name: workflow.supplier_name,
        document_id: workflow.document_id
      }
    }

    // Insert audit log
    const { error: auditError } = await supabase
      .from('approval_audit_logs')
      .insert(auditEntry)

    if (auditError) {
      console.error('Failed to create audit log:', auditError)
      return new Response(
        JSON.stringify({ error: 'Failed to create audit log', details: auditError }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    // Update workflow state if it changed
    if (newState !== previousState) {
      const { error: updateError } = await supabase
        .from('approval_workflows')
        .update({
          current_state: newState,
          updated_at: timestamp
        })
        .eq('id', workflow_id)

      if (updateError) {
        console.error('Failed to update workflow:', updateError)
        return new Response(
          JSON.stringify({ error: 'Failed to update workflow', details: updateError }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }
    }

    // Create notification message
    const actionLabel = {
      approve: 'approved',
      reject: 'rejected',
      request_revision: 'requested revision for',
      comment: 'commented on'
    }[action]

    const notificationMessage = `${userName} ${actionLabel} ${workflow.supplier_name}'s report. Next action: ${nextAction}`

    console.log('Workflow action processed successfully:', {
      workflow_id,
      previousState,
      newState,
      action
    })

    return new Response(
      JSON.stringify({ 
        success: true,
        workflow_id: workflow_id,
        new_state: newState,
        audit_entry: {
          timestamp,
          actor: userName,
          previous_state: previousState,
          new_state: newState,
          comment: comment || null,
          digital_signature: digitalSignature
        },
        notification_message: notificationMessage,
        next_action: nextAction
      }),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )

  } catch (error) {
    console.error('Approval workflow error:', error)
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Approval workflow failed',
        details: error instanceof Error ? error.stack : undefined
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    )
  }
})
