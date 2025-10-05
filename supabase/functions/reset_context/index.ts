import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

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

    // Authenticate user
    const authHeader = req.headers.get('Authorization');
    if (!authHeader) {
      return new Response(JSON.stringify({ error: 'Missing authorization header' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const token = authHeader.replace('Bearer ', '');
    const { data: { user }, error: authError } = await supabase.auth.getUser(token);
    
    if (authError || !user) {
      console.error('Auth error:', authError);
      return new Response(JSON.stringify({ error: 'Unauthorized' }), {
        status: 401,
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      });
    }

    const { 
      session_file_ids = [],
      preserve_documents = false 
    } = await req.json();

    console.log('Resetting context for user:', user.id, {
      session_file_ids_count: session_file_ids.length,
      preserve_documents
    });

    const resetLog: any = {
      timestamp: new Date().toISOString(),
      user_id: user.id,
      actions: [],
      preserved_file_ids: session_file_ids,
      index_ready: false
    };

    // Step 1: Clear demo/test documents from processing_jobs
    try {
      // First, find demo documents
      const { data: demoDocs, error: demoDocsError } = await supabase
        .from('documents')
        .select('id')
        .or('filename.ilike.%demo%,filename.ilike.%test%,filename.ilike.%sample%');

      if (!demoDocsError && demoDocs && demoDocs.length > 0) {
        const demoDocIds = demoDocs.map((d: any) => d.id);

        // Now find jobs related to these demo documents
        const { data: jobsToDelete, error: jobsQueryError } = await supabase
          .from('processing_jobs')
          .select('id, document_id')
          .in('document_id', demoDocIds);

        if (jobsQueryError) {
          console.error('Error querying demo jobs:', jobsQueryError);
        } else if (jobsToDelete && jobsToDelete.length > 0) {
          const jobIds = jobsToDelete.map((j: any) => j.id);
          
          const { error: deleteJobsError } = await supabase
            .from('processing_jobs')
            .delete()
            .in('id', jobIds);

          if (deleteJobsError) {
            console.error('Error deleting demo jobs:', deleteJobsError);
            resetLog.actions.push({
              action: 'purge_demo_jobs',
              status: 'failed',
              error: deleteJobsError.message
            });
          } else {
            resetLog.actions.push({
              action: 'purge_demo_jobs',
              status: 'success',
              count: jobsToDelete.length
            });
            console.log(`Purged ${jobsToDelete.length} demo processing jobs`);
          }
        }
      }
    } catch (error) {
      console.error('Error in demo jobs purge:', error);
      resetLog.actions.push({
        action: 'purge_demo_jobs',
        status: 'error',
        error: error instanceof Error ? error.message : 'Unknown error'
      });
    }

    // Step 2: Clear demo documents (unless preserve_documents is true)
    if (!preserve_documents) {
      try {
        const { data: docsToDelete, error: docsQueryError } = await supabase
          .from('documents')
          .select('id, filename')
          .eq('user_id', user.id)
          .or('filename.ilike.%demo%,filename.ilike.%test%,filename.ilike.%sample%,filename.ilike.%example%');

        if (docsQueryError) {
          console.error('Error querying demo docs:', docsQueryError);
        } else if (docsToDelete && docsToDelete.length > 0) {
          // Don't delete files that are in session_file_ids
          const docsToActuallyDelete = docsToDelete.filter(
            (d: any) => !session_file_ids.includes(d.id)
          );

          if (docsToActuallyDelete.length > 0) {
            const docIds = docsToActuallyDelete.map((d: any) => d.id);
            
            // First delete related data
            await supabase.from('vendor_offers').delete().in('document_id', docIds);
            await supabase.from('approval_workflows').delete().in('document_id', docIds);
            await supabase.from('processing_jobs').delete().in('document_id', docIds);

            // Then delete documents
            const { error: deleteDocsError } = await supabase
              .from('documents')
              .delete()
              .in('id', docIds);

            if (deleteDocsError) {
              console.error('Error deleting demo docs:', deleteDocsError);
              resetLog.actions.push({
                action: 'purge_demo_documents',
                status: 'failed',
                error: deleteDocsError.message
              });
            } else {
              resetLog.actions.push({
                action: 'purge_demo_documents',
                status: 'success',
                count: docsToActuallyDelete.length,
                preserved_count: docsToDelete.length - docsToActuallyDelete.length
              });
              console.log(`Purged ${docsToActuallyDelete.length} demo documents, preserved ${docsToDelete.length - docsToActuallyDelete.length}`);
            }
          }
        }
      } catch (error) {
        console.error('Error in demo docs purge:', error);
        resetLog.actions.push({
          action: 'purge_demo_documents',
          status: 'error',
          error: error instanceof Error ? error.message : 'Unknown error'
        });
      }
    } else {
      resetLog.actions.push({
        action: 'preserve_documents',
        status: 'skipped',
        reason: 'preserve_documents flag set to true'
      });
    }

    // Step 3: Clear stale processing jobs (older than 24 hours, failed/error status)
    try {
      const oneDayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
      
      const { data: staleJobs, error: staleQueryError } = await supabase
        .from('processing_jobs')
        .select('id')
        .eq('user_id', user.id)
        .in('job_status', ['failed', 'error'])
        .lt('created_at', oneDayAgo);

      if (!staleQueryError && staleJobs && staleJobs.length > 0) {
        const { error: deleteStaleError } = await supabase
          .from('processing_jobs')
          .delete()
          .in('id', staleJobs.map((j: any) => j.id));

        if (deleteStaleError) {
          console.error('Error deleting stale jobs:', deleteStaleError);
        } else {
          resetLog.actions.push({
            action: 'purge_stale_jobs',
            status: 'success',
            count: staleJobs.length
          });
          console.log(`Purged ${staleJobs.length} stale processing jobs`);
        }
      }
    } catch (error) {
      console.error('Error in stale jobs purge:', error);
    }

    // Step 4: Verify session file_ids still exist
    const validFileIds: string[] = [];
    if (session_file_ids.length > 0) {
      try {
        const { data: sessionDocs, error: sessionQueryError } = await supabase
          .from('documents')
          .select('id, filename')
          .in('id', session_file_ids)
          .eq('user_id', user.id);

        if (!sessionQueryError && sessionDocs) {
          validFileIds.push(...sessionDocs.map((d: any) => d.id));
          resetLog.actions.push({
            action: 'verify_session_files',
            status: 'success',
            valid_count: sessionDocs.length,
            invalid_count: session_file_ids.length - sessionDocs.length
          });
          console.log(`Verified ${sessionDocs.length}/${session_file_ids.length} session files`);
        }
      } catch (error) {
        console.error('Error verifying session files:', error);
      }
    }

    // Step 5: Rebuild index readiness check
    try {
      // Count valid documents for this user
      const { count: docCount, error: countError } = await supabase
        .from('documents')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('upload_status', 'completed');

      if (!countError && docCount !== null) {
        resetLog.index_ready = docCount > 0;
        resetLog.actions.push({
          action: 'rebuild_index',
          status: 'ready',
          documents_count: docCount,
          valid_session_files: validFileIds.length
        });
        console.log(`Index ready: ${docCount} documents available`);
      } else {
        resetLog.index_ready = false;
        resetLog.actions.push({
          action: 'rebuild_index',
          status: 'no_documents',
          documents_count: 0
        });
      }
    } catch (error) {
      console.error('Error checking index readiness:', error);
      resetLog.index_ready = false;
    }

    // Step 6: Clear any cached results (vendor_offers, risk_assessments, etc. without linked docs)
    try {
      // Get all document IDs for this user
      const { data: userDocs, error: userDocsError } = await supabase
        .from('documents')
        .select('id')
        .eq('user_id', user.id);

      if (!userDocsError && userDocs) {
        const userDocIds = userDocs.map((d: any) => d.id);

        // Find orphaned vendor offers (offers not linked to user's documents)
        const { data: orphanedOffers, error: orphanQueryError } = await supabase
          .from('vendor_offers')
          .select('id, document_id')
          .not('document_id', 'in', `(${userDocIds.join(',')})`);

        if (!orphanQueryError && orphanedOffers && orphanedOffers.length > 0) {
        const offerIds = orphanedOffers.map((o: any) => o.id);
        
        // Delete related data first
        await supabase.from('tco_calculations').delete().in('vendor_offer_id', offerIds);
        await supabase.from('risk_assessments').delete().in('vendor_offer_id', offerIds);
        await supabase.from('lead_time_analysis').delete().in('vendor_offer_id', offerIds);
        
        // Delete orphaned offers
        const { error: deleteOffersError } = await supabase
          .from('vendor_offers')
          .delete()
          .in('id', offerIds);

        if (!deleteOffersError) {
          resetLog.actions.push({
            action: 'purge_orphaned_offers',
            status: 'success',
            count: orphanedOffers.length
          });
          console.log(`Purged ${orphanedOffers.length} orphaned vendor offers`);
        }
      }
      }
    } catch (error) {
      console.error('Error purging orphaned data:', error);
    }

    // Final summary
    resetLog.summary = {
      context_cleared: true,
      demo_data_purged: resetLog.actions.some((a: any) => 
        a.action.includes('demo') && a.status === 'success'
      ),
      session_files_preserved: validFileIds.length,
      index_ready: resetLog.index_ready,
      total_actions: resetLog.actions.length,
      successful_actions: resetLog.actions.filter((a: any) => a.status === 'success').length
    };

    console.log('Context reset complete:', resetLog.summary);

    return new Response(JSON.stringify(resetLog), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });

  } catch (error) {
    console.error('Error in reset_context function:', error);
    return new Response(JSON.stringify({ 
      error: error instanceof Error ? error.message : 'Unknown error',
      details: error instanceof Error ? error.stack : undefined,
      index_ready: false
    }), {
      status: 500,
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
    });
  }
});
