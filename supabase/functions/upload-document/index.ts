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

    if (req.method === 'POST') {
      // Parse JSON body with base64 file content
      const { filename, mime, size, file_b64 } = await req.json();

      if (!filename || !file_b64) {
        return new Response(
          JSON.stringify({ error: 'Missing filename or file_b64' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Validation guards
      if (!size || size === 0) {
        return new Response(
          JSON.stringify({ error: 'Empty file received' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      if (size > 50 * 1024 * 1024) {
        return new Response(
          JSON.stringify({ error: 'File exceeds 50MB limit' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Validate file type
      const allowedTypes = [
        'application/pdf',
        'application/vnd.ms-excel',
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        'text/csv'
      ]

      if (!allowedTypes.includes(mime)) {
        return new Response(
          JSON.stringify({ error: 'Invalid file type. Only PDF, Excel, and CSV files are allowed.' }),
          { status: 400, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      console.log(`Received upload: ${filename}, ${size} bytes, MIME: ${mime}, base64 length: ${file_b64.length}`);

      // Decode base64 to bytes
      const binaryString = atob(file_b64);
      const bytes = new Uint8Array(binaryString.length);
      for (let i = 0; i < binaryString.length; i++) {
        bytes[i] = binaryString.charCodeAt(i);
      }

      console.log(`Decoded ${bytes.length} bytes from base64`);

      // Check if bucket exists, create if not
      const { data: buckets } = await supabase.storage.listBuckets()
      const bucketExists = buckets?.some(b => b.name === 'procurement-documents')
      
      if (!bucketExists) {
        const { error: bucketError } = await supabase.storage.createBucket('procurement-documents', {
          public: false,
          fileSizeLimit: 52428800 // 50MB
        })
        
        if (bucketError) {
          console.error('Bucket creation error:', bucketError)
          // Continue anyway - bucket might exist from another request
        }
      }

      // Upload file to Supabase Storage
      const filePath = `${user.id}/${Date.now()}-${filename}`
      
      const { data: uploadData, error: uploadError } = await supabase.storage
        .from('procurement-documents')
        .upload(filePath, bytes.buffer, {
          contentType: mime,
          upsert: false
        })

      if (uploadError) {
        console.error('Storage upload error:', uploadError)
        return new Response(
          JSON.stringify({ error: 'Failed to upload file to storage' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Store file metadata in database
      const { data: document, error: dbError } = await supabase
        .from('documents')
        .insert({
          filename: filename,
          file_path: filePath,
          file_size: size,
          mime_type: mime,
          upload_status: 'completed',
          user_id: user.id
        })
        .select()
        .single()

      if (dbError) {
        console.error('Database error:', dbError)
        return new Response(
          JSON.stringify({ error: 'Failed to save document metadata' }),
          { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        )
      }

      // Create processing job
      const { data: job, error: jobError } = await supabase
        .from('processing_jobs')
        .insert({
          document_id: document.id,
          job_status: 'queued',
          job_type: 'document_analysis',
          progress: 0,
          result_data: { storage_path: filePath }
        })
        .select()
        .single()

      if (jobError) {
        console.error('Job creation error:', jobError)
      }

      return new Response(
        JSON.stringify({
          id: document.id,
          filename: document.filename,
          status: document.upload_status,
          job_id: job?.id || null,
          message: 'Document uploaded successfully',
          storage_path: filePath
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