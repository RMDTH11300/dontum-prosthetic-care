// Copy this file to portal-config.js ONLY after the hospital approves the data-processing setup.
// The publishable key is safe for browser use ONLY together with correctly tested RLS policies.
// NEVER put a service_role key, secret key, password, or connection string in this file.
window.DT_PORTAL_CONFIG = {
  url: 'https://YOUR-PROJECT.supabase.co',
  publishableKey: 'YOUR-SUPABASE-PUBLISHABLE-KEY',
  productionApproved: false
};
