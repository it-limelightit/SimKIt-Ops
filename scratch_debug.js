const { createClient } = require('@supabase/supabase-js');
const url = "https://mbycybczlccvgcqdlqwj.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";
const supabase = createClient(url, key);

async function run() {
  console.log("=== PROFILES CHECK ===");
  const { data: profiles, error: pErr } = await supabase
    .from('profiles')
    .select('id, name, email, mobile, whatsapp, is_active, created_at');

  if (pErr) {
    console.error("Profiles error:", pErr);
    return;
  }

  console.log(`Total profiles found: ${profiles.length}`);
  for (const p of profiles) {
    const { data: roles } = await supabase
      .from('user_roles')
      .select('role')
      .eq('user_id', p.id);
    const roleNames = (roles || []).map(r => r.role).join(', ');
    console.log(`- ${p.name || 'Unnamed'} | Email: ${p.email} | Mobile: ${p.mobile} | Active: ${p.is_active} | Roles: [${roleNames}]`);
  }
}

run();
