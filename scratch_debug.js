const { createClient } = require('@supabase/supabase-js');
const url = "https://mbycybczlccvgcqdlqwj.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";
const supabase = createClient(url, key);

async function run() {
  console.log("=== DOLPHIN POLYMERS CHECK ===");
  const { data: sites, error: sErr } = await supabase
    .from('sites')
    .select('id, name, company_name, assigned_worker_id, consultant_stage, task_notes')
    .ilike('name', '%Dolphin%');

  if (sErr) {
    console.error("Sites error:", sErr);
    return;
  }

  console.log(`Total sites found: ${sites.length}`);
  for (const s of sites) {
    console.log(`\nSite: ${s.name} (ID: ${s.id})`);
    console.log(`Assigned Worker ID: ${s.assigned_worker_id}`);
    console.log(`Consultant Stage: ${s.consultant_stage}`);
    console.log(`Task Notes: ${s.task_notes}`);

    const { data: a } = await supabase.from('assessment').select('*').eq('site_id', s.id);
    console.log(`Assessment rows: ${JSON.stringify(a, null, 2)}`);

    const { data: inst } = await supabase.from('installation').select('*').eq('site_id', s.id);
    console.log(`Installation rows: ${JSON.stringify(inst, null, 2)}`);

    const { data: comm } = await supabase.from('commissioning').select('*').eq('site_id', s.id);
    console.log(`Commissioning rows: ${JSON.stringify(comm, null, 2)}`);
  }
}

run();
