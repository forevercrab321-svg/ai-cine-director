/// <reference types="vite/client" />
import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// Use console.error for visibility in logs
if (!supabaseUrl || !supabaseAnonKey) {
  const msg = '❌ Missing Supabase environment variables! Please check your .env.local or Vercel Project Settings.';
  console.error(msg);
  // Throwing might break the app initialization completely, which is good for debugging but bad for UX if recoverability is desired.
  // However, without Supabase, the app is useless.
}

// Fallback to empty string to prevent createClient crash on load, but requests will fail
export const supabase = createClient(supabaseUrl || '', supabaseAnonKey || '')
