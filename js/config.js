// Server connection. Fill these in from Supabase: Project Settings → API.
// The anon key is designed to be public; access is enforced by the database rules in supabase/schema.sql.
export const SUPABASE_URL = '';        // e.g. 'https://abcdefghijklm.supabase.co'
export const SUPABASE_ANON_KEY = '';   // the long "anon public" key

// Workers sign in with a username; behind the scenes it becomes <username>@USERNAME_DOMAIN.
// Keep in sync with supabase/functions/admin-users/index.ts. No email is ever sent to these addresses.
export const USERNAME_DOMAIN = 'users.gazi-field.app';
