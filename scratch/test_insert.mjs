import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mbycybczlccvgcqdlqwj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

async function run() {
  console.log("Attempting mock insert to diagnose the 400 Bad Request...");
  
  const { data, error } = await supabase
    .from("inventory_materials")
    .insert({
      material_name: "Test Company",
      location: "Ahmedabad",
      device_id: "Test Device",
      submitted: true,
      state: "Available",
      ct1: "FALSE",
      ct2: "FALSE",
      ct3: "FALSE",
      proxy_model: null,
      proxy1: "FALSE",
      proxy2: "FALSE",
      encoder: "FALSE",
      vibration: "FALSE",
      vibration_model: null,
      antenna: "FALSE",
      tower_light: "FALSE",
      energy_meter: "FALSE",
      plc: "FALSE",
      quantity: 1,
      unit: "pcs",
      notes: JSON.stringify({
        courier_partner: "",
        packing_date: "",
        transit_date: "",
        arrived_date: "",
        courier_id: "",
        logistics_status: "Pending"
      })
    })
    .select();

  if (error) {
    console.error("FAILED with error details:");
    console.error(JSON.stringify(error, null, 2));
  } else {
    console.log("SUCCESS! Row inserted successfully:", data);
  }
}

run();
