import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.38.4";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseKey);

    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(
        JSON.stringify({ error: 'Authorization required' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);

    if (authError || !user) {
      return new Response(
        JSON.stringify({ error: 'Invalid token' }),
        { status: 401, headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    console.log(`[INGEST-GUARD] Running for user ${user.id}`);

    // Fetch all documents uploaded by this user
    const { data: documents, error: docsError } = await supabase
      .from('documents')
      .select('*')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });

    if (docsError) {
      console.error('[INGEST-GUARD] Error fetching documents:', docsError);
      throw new Error('Failed to fetch documents');
    }

    // Build file inventory with metadata
    const fileInventory = documents?.map(doc => {
      // Extract page/sheet count from metadata if available
      const pageCount = doc.file_size ? Math.ceil(doc.file_size / 4096) : null; // Rough estimate
      
      return {
        id: doc.id,
        filename: doc.filename,
        mime_type: doc.mime_type,
        file_size: doc.file_size,
        estimated_pages: pageCount,
        upload_status: doc.upload_status,
        uploaded_at: doc.created_at,
        is_demo: false // Real uploaded files are never demo
      };
    }) || [];

    // Check for any demo/mock data markers
    const demoFiles = fileInventory.filter(f => 
      f.filename.toLowerCase().includes('demo') || 
      f.filename.toLowerCase().includes('mock') ||
      f.filename.toLowerCase().includes('sample')
    );

    // Fetch processing jobs to verify RAG index status
    const { data: jobs, error: jobsError } = await supabase
      .from('processing_jobs')
      .select('*, documents(*)')
      .eq('documents.user_id', user.id)
      .eq('job_status', 'completed')
      .order('created_at', { ascending: false });

    if (jobsError) {
      console.error('[INGEST-GUARD] Error fetching jobs:', jobsError);
    }

    const indexReady = jobs && jobs.length > 0;
    const processedDocIds = jobs?.map(j => j.document_id) || [];

    // Identify any documents not yet processed
    const unprocessedDocs = fileInventory.filter(f => !processedDocIds.includes(f.id));

    console.log(`[INGEST-GUARD] Found ${fileInventory.length} documents, ${demoFiles.length} potential demo files`);
    console.log(`[INGEST-GUARD] RAG index ready: ${indexReady}, ${unprocessedDocs.length} unprocessed docs`);

    // Build response
    const response = {
      files: fileInventory,
      index_ready: indexReady && unprocessedDocs.length === 0,
      removed_demo_files: demoFiles.map(f => f.filename),
      unprocessed_documents: unprocessedDocs.map(d => ({
        id: d.id,
        filename: d.filename,
        status: d.upload_status
      })),
      stats: {
        total_files: fileInventory.length,
        total_size_bytes: fileInventory.reduce((sum, f) => sum + (f.file_size || 0), 0),
        demo_files_count: demoFiles.length,
        processed_jobs_count: jobs?.length || 0,
        unprocessed_count: unprocessedDocs.length
      },
      message: indexReady 
        ? 'RAG index built from user-uploaded files only' 
        : `${unprocessedDocs.length} documents awaiting processing`,
      timestamp: new Date().toISOString()
    };

    return new Response(
      JSON.stringify(response),
      { 
        status: 200, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );

  } catch (error) {
    console.error('[INGEST-GUARD] Error:', error);
    return new Response(
      JSON.stringify({ 
        error: error instanceof Error ? error.message : 'Ingestion guard failed',
        files: [],
        index_ready: false,
        removed_demo_files: []
      }),
      { 
        status: 500, 
        headers: { ...corsHeaders, 'Content-Type': 'application/json' } 
      }
    );
  }
});
