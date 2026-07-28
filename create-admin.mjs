import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mbycybczlccvgcqdlqwj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const EMAIL = process.env.ADMIN_EMAIL;
const PASSWORD = process.env.ADMIN_PASSWORD;

if (!EMAIL || !PASSWORD) {
  console.error("Set ADMIN_EMAIL and ADMIN_PASSWORD before running this script.");
  process.exit(1);
}

async function run() {
  // Step 1: Sign up
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: EMAIL,
    password: PASSWORD,
    options: {
      data: { name: "Tarun", role: "supervisor" },
      emailRedirectTo: "https://sim-k-it-ops-mfbq.vercel.app",
    },
  });

  if (signUpError) {
    console.error("Signup error:", signUpError.message);
    process.exit(1);
  }

  const user = signUpData.user;
  console.log("User created:", user?.id);
  console.log("Email confirmed:", user?.email_confirmed_at ? "yes" : "no (check inbox or disable confirm in Supabase dashboard)");

  if (!user?.id) {
    console.error("No user ID returned");
    process.exit(1);
  }

  // Step 2: Sign in immediately to get a session
  const { data: signInData, error: signInError } = await supabase.auth.signInWithPassword({
    email: EMAIL,
    password: PASSWORD,
  });

  if (signInError) {
    console.log("Cannot sign in yet (likely needs email confirmation).");
    console.log("→ Go to Supabase dashboard → Authentication → Users → find info@limelightit.io → confirm manually");
    console.log("  OR go to Authentication → Settings → disable 'Enable email confirmations'");
    process.exit(0);
  }

  const uid = signInData.user?.id;
  console.log("Signed in as:", uid);

  // Step 3: Ensure profile row exists and is active
  const { error: profileError } = await supabase.from("profiles").upsert({
    id: uid,
    email: EMAIL,
    name: "Tarun",
    is_active: true,
  }, { onConflict: "id" });
  if (profileError) console.error("Profile upsert error:", profileError.message);
  else console.log("✓ Profile set (is_active = true)");

  // Step 4: Ensure user_roles row is supervisor
  const { error: roleError } = await supabase.from("user_roles").upsert({
    user_id: uid,
    role: "supervisor",
  }, { onConflict: "user_id" });
  if (roleError) console.error("Role upsert error:", roleError.message);
  else console.log("✓ Role set to supervisor");

  console.log("\nDone! You can now log in at the app with:");
  console.log("  Email:    ", EMAIL);
  console.log("  Password: [value supplied through ADMIN_PASSWORD]");
}

run();
