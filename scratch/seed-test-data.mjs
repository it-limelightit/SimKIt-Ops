import { createClient } from "@supabase/supabase-js";
import fs from "fs";
import path from "path";

// Manually parse .env file
const envPath = path.resolve(process.cwd(), ".env");
const env = {};
if (fs.existsSync(envPath)) {
  const content = fs.readFileSync(envPath, "utf-8");
  content.split(/\r?\n/).forEach((line) => {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) return;
    const idx = trimmed.indexOf("=");
    if (idx !== -1) {
      const key = trimmed.substring(0, idx).trim();
      let value = trimmed.substring(idx + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.substring(1, value.length - 1);
      }
      env[key] = value;
    }
  });
}

const supabaseUrl = env.VITE_SUPABASE_URL || env.SUPABASE_URL;
const supabaseAnonKey = env.VITE_SUPABASE_PUBLISHABLE_KEY || env.SUPABASE_PUBLISHABLE_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  console.error("❌ Missing SUPABASE_URL or SUPABASE_PUBLISHABLE_KEY in .env file.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseAnonKey);

async function main() {
  console.log("Signing in as manager programmatically...");
  const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
    email: "manager@example.com",
    password: "SuperSecureManager@2026$",
  });

  if (authError) {
    console.error("❌ Auth error:", authError.message);
    console.log("💡 Attempting to seed directly as anonymous user in case RLS is disabled...");
  }

  const userId = authData?.user?.id || null;
  if (userId) {
    console.log("✅ Authenticated successfully! User ID:", userId);
  }

  console.log("Inserting test data...");
  
  const testData = [
    {
      device_id: "DM-027",
      quantity: 0,
      material_name: "Pure Temptation (not working)",
      version: "1.0.180327",
      ota_key: "5e97f426-d490-420d-9462-e94c878d8e98",
      ota_account: "kuldeepshrimali.limelight@gmail.com",
      ct1: "TRUE",
      ct2: "TRUE",
      ct3: "TRUE",
      proxy1: "TRUE",
      proxy2: "FALSE",
      encoder: "FALSE",
      vibration: "TRUE",
      antenna: "FALSE",
      tower_light: "TRUE",
      submitted: true,
      energy_meter: "FALSE",
      plc: "FALSE",
      flash_size: "Flash-16mb",
      vibration_model: "renke",
      proxy_model: "inductive",
      state: "Available",
      created_by: userId
    },
    {
      device_id: "DM-101",
      quantity: 1,
      material_name: "Aatomize",
      version: "3.0.1",
      ota_key: "0bda416c-b70b-48a4-9b5f-f9be1ad54669",
      ota_account: "kuldeepshrimali.limelight@gmail.com",
      uplink: "LTE",
      ct1: "TRUE",
      ct2: "TRUE",
      ct3: "TRUE",
      proxy1: "FALSE",
      proxy2: "FALSE",
      encoder: "FALSE",
      vibration: "TRUE",
      antenna: "TRUE",
      tower_light: "TRUE",
      submitted: true,
      energy_meter: "FALSE",
      plc: "FALSE",
      flash_size: "Flash-16mb",
      vibration_model: "witmotion",
      installation_date: "2026-06-26",
      iccid: "89918570407083025936",
      remark: "Three phase monitoring is done for state detection Channel A is used for CT based counting",
      state: "Available",
      created_by: userId
    }
  ];

  const { data, error } = await supabase
    .from("inventory_materials")
    .upsert(testData, { onConflict: "device_id" });

  if (error) {
    console.error("❌ Insert error:", error.message);
    console.log("\n💡 TIP: If you still see RLS errors, copy-paste the SQL commands directly into your Supabase Dashboard SQL Editor.");
  } else {
    console.log("✅ Seed completed successfully!");
  }
}

main().catch((err) => {
  console.error("❌ Fatal error:", err);
});
