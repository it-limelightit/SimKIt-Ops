const { createClient } = require('@supabase/supabase-js');
const url = "https://mbycybczlccvgcqdlqwj.supabase.co";
const key = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";
const supabase = createClient(url, key);

async function run() {
  const { data: sites } = await supabase.from('sites').select('id,name,company_name');
  const { data: mat } = await supabase.from('inventory_materials').select('id,material_name,submitted,state,notes');
  console.log("=== SITES ===");
  console.log(sites);
  console.log("=== MATERIALS ===");
  console.log(mat);
}
run();
