import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mbycybczlccvgcqdlqwj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data: roles, error } = await supabase.from("user_roles").select("role");
  if (error) {
    console.error("Error fetching user roles:", error);
    return;
  }
  
  const counts = {
    supervisor: 0,
    worker: 0,
    owner: 0,
    unknown: 0
  };
  
  roles.forEach(row => {
    if (counts[row.role] !== undefined) {
      counts[row.role]++;
    } else {
      counts.unknown++;
    }
  });
  
  console.log("=== USER ROLE COUNTS ===");
  console.log("Managers (supervisor):", counts.supervisor);
  console.log("Business Consultants (worker):", counts.worker);
  console.log("Owners (owner):", counts.owner);
  console.log("Total Users:", roles.length);
}

run();
