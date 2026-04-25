import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

const isValidUrl = supabaseUrl && supabaseUrl.startsWith('http') && supabaseAnonKey && supabaseAnonKey.length > 20;

if (!isValidUrl) {
  console.warn('Supabase credentials not set — running in demo mode');
}

export const supabase = isValidUrl
  ? createClient(supabaseUrl, supabaseAnonKey)
  : null;

export const isDemoMode = !supabase;
