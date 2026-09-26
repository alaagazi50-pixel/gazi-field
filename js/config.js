// Server connection. Fill these in from Supabase: Project Settings → API.
// The anon key is designed to be public; access is enforced by the database rules in supabase/schema.sql.
export const SUPABASE_URL = 'https://uxckfaplukcyorndqggh.supabase.co';
export const SUPABASE_ANON_KEY = 'sb_publishable_WcLNB-8bXZWsTVixrrFn0g_IsPK-rSg';

// Name of the account-management Edge Function as deployed in Supabase (Edge Functions page).
export const ADMIN_FUNCTION = 'super-handler';

// Push reminders: the reminders Edge Function's name, and the public half of the push key pair
// (the private half is an Edge Function secret, never in the app).
export const REMINDER_FUNCTION = 'reminders';
export const VAPID_PUBLIC_KEY = 'BID6OLCjBQU0YlQCEAQIae-rnqIp3XPg55YRLAJSLl5MiwaTxYFiUOecjrflJFqXx5NE5CnjG-NSfI5yXxsPD1g';

// Workers sign in with a username; behind the scenes it becomes <username>@USERNAME_DOMAIN.
// Keep in sync with supabase/functions/admin-users/index.ts. No email is ever sent to these addresses.
export const USERNAME_DOMAIN = 'users.gazi-field.app';
