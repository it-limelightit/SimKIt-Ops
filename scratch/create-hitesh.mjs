import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mbycybczlccvgcqdlqwj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log("Signing up Hitesh via Supabase Auth API...");
  const { data, error } = await supabase.auth.signUp({
    email: "associatelimelight@gmail.com",
    password: "Hitesh@limelight123",
    options: {
      data: {
        name: "Hitesh",
        mobile: "+91 93130 48188",
        whatsapp: "+91 93130 48188",
        role: "supervisor"
      }
    }
  });

  if (error) {
    console.error("Signup error:", error.message);
    return;
  }

  console.log("=========================================");
  console.log("User created in Supabase Auth successfully!");
  console.log("User ID:", data.user?.id);
  console.log("=========================================");
  console.log("\nNext step: Run the SQL activation script in the Supabase SQL editor.");
}

run();
