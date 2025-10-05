import { serve } from "https://deno.land/std@0.168.0/http/server.ts"
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { z } from 'https://deno.land/x/zod@v3.22.4/mod.ts'

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

const ActionItemSchema = z.object({
  label: z.enum(['Action', 'Follow-Up', 'Review']),
  task: z.string(),
  priority: z.enum(['High', 'Medium', 'Low']),
  assignee: z.string().optional(),
  due_date: z.string().optional(),
})

const TaskSyncRequestSchema = z.object({
  platform: z.enum(['jira', 'notion', 'clickup', 'zapier']),
  action_items: z.array(ActionItemSchema).min(1),
  report_url: z.string().url().optional(),
  workflow_id: z.string().uuid().optional(),
  config: z.object({
    // Jira config
    jira_project_key: z.string().optional(),
    jira_url: z.string().url().optional(),
    jira_email: z.string().email().optional(),
    jira_api_token: z.string().optional(),
    
    // Notion config
    notion_database_id: z.string().optional(),
    notion_api_key: z.string().optional(),
    
    // ClickUp config
    clickup_list_id: z.string().optional(),
    clickup_api_token: z.string().optional(),
    
    // Zapier config
    zapier_webhook_url: z.string().url().optional(),
  }).optional(),
  send_to_platform: z.boolean().default(false),
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
    const validation = TaskSyncRequestSchema.safeParse(requestBody)
    
    if (!validation.success) {
      return new Response(
        JSON.stringify({ error: 'Invalid request', details: validation.error.errors }),
        { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      )
    }

    const { platform, action_items, report_url, workflow_id, config, send_to_platform } = validation.data

    console.log(`Converting ${action_items.length} action items for ${platform}`)

    // Generate report URL if workflow_id provided
    const reportLink = report_url || (workflow_id 
      ? `${supabaseUrl.replace('.supabase.co', '.lovable.app')}/workflow/${workflow_id}`
      : 'https://claritychain.ai')

    let payloads: any[] = []
    let platformResponse = null

    switch (platform) {
      case 'jira':
        payloads = convertToJira(action_items, reportLink, config)
        if (send_to_platform && config?.jira_url && config?.jira_email && config?.jira_api_token) {
          platformResponse = await sendToJira(payloads, config)
        }
        break

      case 'notion':
        payloads = convertToNotion(action_items, reportLink, config)
        if (send_to_platform && config?.notion_database_id && config?.notion_api_key) {
          platformResponse = await sendToNotion(payloads, config)
        }
        break

      case 'clickup':
        payloads = convertToClickUp(action_items, reportLink, config)
        if (send_to_platform && config?.clickup_list_id && config?.clickup_api_token) {
          platformResponse = await sendToClickUp(payloads, config)
        }
        break

      case 'zapier':
        payloads = convertToZapier(action_items, reportLink)
        if (send_to_platform && config?.zapier_webhook_url) {
          platformResponse = await sendToZapier(payloads, config)
        }
        break
    }

    return new Response(
      JSON.stringify({
        success: true,
        platform,
        payloads,
        sent_to_platform: send_to_platform,
        platform_response: platformResponse,
        items_converted: action_items.length,
      }),
      {
        status: 200,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )

  } catch (error) {
    console.error('Error syncing tasks:', error)
    return new Response(
      JSON.stringify({
        error: error instanceof Error ? error.message : 'Failed to sync tasks',
        details: error instanceof Error ? error.stack : undefined
      }),
      {
        status: 500,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' }
      }
    )
  }
})

function convertToJira(items: any[], reportUrl: string, config?: any) {
  const projectKey = config?.jira_project_key || 'PROC'
  
  return items.map(item => {
    const summary = truncate(item.task, 80)
    const description = `${item.task}\n\nLabel: ${item.label}\nPriority: ${item.priority}\n${item.assignee ? `Assignee: ${item.assignee}\n` : ''}View Report: ${reportUrl}`
    
    return {
      fields: {
        project: { key: projectKey },
        summary,
        description,
        priority: { name: item.priority },
        issuetype: { name: mapLabelToIssueType(item.label) },
        ...(item.assignee && { assignee: { name: item.assignee } }),
        ...(item.due_date && { duedate: item.due_date }),
        customfield_reportURL: reportUrl,
      }
    }
  })
}

function convertToNotion(items: any[], reportUrl: string, config?: any) {
  return items.map(item => ({
    parent: { database_id: config?.notion_database_id || '' },
    properties: {
      Name: {
        title: [
          {
            text: {
              content: truncate(item.task, 100)
            }
          }
        ]
      },
      Priority: {
        select: {
          name: item.priority
        }
      },
      Type: {
        select: {
          name: item.label
        }
      },
      ...(item.assignee && {
        Assignee: {
          rich_text: [
            {
              text: {
                content: item.assignee
              }
            }
          ]
        }
      }),
      ...(item.due_date && {
        'Due Date': {
          date: {
            start: item.due_date
          }
        }
      }),
      'Report URL': {
        url: reportUrl
      },
      Description: {
        rich_text: [
          {
            text: {
              content: item.task
            }
          }
        ]
      }
    }
  }))
}

function convertToClickUp(items: any[], reportUrl: string, config?: any) {
  return items.map(item => ({
    name: truncate(item.task, 80),
    description: `${item.task}\n\nView Report: ${reportUrl}`,
    priority: mapPriorityToClickUp(item.priority),
    ...(item.assignee && { assignees: [item.assignee] }),
    ...(item.due_date && { due_date: new Date(item.due_date).getTime() }),
    tags: [item.label],
    custom_fields: [
      {
        name: 'Report URL',
        value: reportUrl
      }
    ]
  }))
}

function convertToZapier(items: any[], reportUrl: string) {
  return items.map(item => ({
    task: item.task,
    label: item.label,
    priority: item.priority,
    assignee: item.assignee || '',
    due_date: item.due_date || '',
    report_url: reportUrl,
    timestamp: new Date().toISOString(),
  }))
}

async function sendToJira(payloads: any[], config: any) {
  const results = []
  
  for (const payload of payloads) {
    try {
      const auth = btoa(`${config.jira_email}:${config.jira_api_token}`)
      const response = await fetch(`${config.jira_url}/rest/api/3/issue`, {
        method: 'POST',
        headers: {
          'Authorization': `Basic ${auth}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      
      if (response.ok) {
        const data = await response.json()
        results.push({ success: true, id: data.id, key: data.key })
      } else {
        const error = await response.text()
        results.push({ success: false, error })
      }
    } catch (error) {
      results.push({ success: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  
  return results
}

async function sendToNotion(payloads: any[], config: any) {
  const results = []
  
  for (const payload of payloads) {
    try {
      const response = await fetch('https://api.notion.com/v1/pages', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${config.notion_api_key}`,
          'Content-Type': 'application/json',
          'Notion-Version': '2022-06-28',
        },
        body: JSON.stringify(payload),
      })
      
      if (response.ok) {
        const data = await response.json()
        results.push({ success: true, id: data.id })
      } else {
        const error = await response.text()
        results.push({ success: false, error })
      }
    } catch (error) {
      results.push({ success: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  
  return results
}

async function sendToClickUp(payloads: any[], config: any) {
  const results = []
  
  for (const payload of payloads) {
    try {
      const response = await fetch(`https://api.clickup.com/api/v2/list/${config.clickup_list_id}/task`, {
        method: 'POST',
        headers: {
          'Authorization': config.clickup_api_token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      })
      
      if (response.ok) {
        const data = await response.json()
        results.push({ success: true, id: data.id })
      } else {
        const error = await response.text()
        results.push({ success: false, error })
      }
    } catch (error) {
      results.push({ success: false, error: error instanceof Error ? error.message : 'Unknown error' })
    }
  }
  
  return results
}

async function sendToZapier(payloads: any[], config: any) {
  try {
    const response = await fetch(config.zapier_webhook_url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        action_items: payloads,
        timestamp: new Date().toISOString(),
      }),
    })
    
    return { 
      success: response.ok, 
      status: response.status,
      message: response.ok ? 'Sent to Zapier webhook' : 'Failed to send to Zapier'
    }
  } catch (error) {
    return { 
      success: false, 
      error: error instanceof Error ? error.message : 'Unknown error' 
    }
  }
}

function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text
  return text.substring(0, maxLength - 3) + '...'
}

function mapLabelToIssueType(label: string): string {
  const mapping: Record<string, string> = {
    'Action': 'Task',
    'Follow-Up': 'Sub-task',
    'Review': 'Story',
  }
  return mapping[label] || 'Task'
}

function mapPriorityToClickUp(priority: string): number {
  const mapping: Record<string, number> = {
    'High': 1,
    'Medium': 3,
    'Low': 4,
  }
  return mapping[priority] || 3
}
