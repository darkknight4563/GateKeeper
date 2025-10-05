import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';

export default function AuthStateInit() {
  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => {
      // no-op, ensures tokens refresh and state persists across reloads
    });
    supabase.auth.getSession();
    return () => subscription.unsubscribe();
  }, []);
  return null;
}
