import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mbycybczlccvgcqdlqwj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  const { data, error } = await supabase
    .from("sites")
    .select("id, name, company_name, city, created_at")
    .order("name");

  if (error) {
    console.error(error);
  } else {
    console.log("Total sites found:", data.length);
    console.log(JSON.stringify(data, null, 2));
  }
}

run();
