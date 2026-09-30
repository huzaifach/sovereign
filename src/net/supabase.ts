// Supabase client — Phase 2 wiring.
// Reads VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY from env.
// Auth: dual signup — username+password maps to <slug>@users.sovereign.game
// (hidden internal email, Supabase Auth requires an email per user).

import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;

export const INTERNAL_EMAIL_DOMAIN = 'users.sovereign.game';

export function usernameToInternalEmail(username: string): string {
  const slug = username.trim().toLowerCase().replace(/[^a-z0-9_]/g, '');
  return `${slug}@${INTERNAL_EMAIL_DOMAIN}`;
}

let client: SupabaseClient | null = null;

export function getSupabase(): SupabaseClient | null {
  if (!url || !anonKey) return null; // Phase 1: local stub mode
  if (!client) client = createClient(url, anonKey);
  return client;
}

export function isOnline(): boolean {
  return getSupabase() !== null;
}
