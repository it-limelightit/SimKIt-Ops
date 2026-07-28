import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://mbycybczlccvgcqdlqwj.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im1ieWN5YmN6bGNjdmdjcWRscXdqIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODEwNjkyNzksImV4cCI6MjA5NjY0NTI3OX0.u5vTvX0LPmAyIVUOCZBX4o-5iVkBT_f9UgY1q8ygoy8";

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function meta(c1_name, c1_mobile, c1_email, c2_name, c2_mobile, c2_email, status) {
  return `[METADATA:${JSON.stringify({
    c1_name: c1_name || "",
    c1_mobile: c1_mobile || "",
    c1_email: c1_email || "",
    c2_name: c2_name || "",
    c2_mobile: c2_mobile || "",
    c2_email: c2_email || "",
    status: status || "",
    create_drive_folder: false,
    drive_folder_name: "",
    drive_folder_link: ""
  })}]`;
}

const sites = [
  { name: "Deepak Cellulose Pvt. Ltd.", city: "Valsad", address: "115 & 115/1, New GIDC, Gundlav, Valsad-396035", task_notes: meta("Ajinath Thombare","9004671263","ajinath.thombare@deepakcellulose.com","Viral Bhai","9978196017","purchase@deepakcellulose.com","Running") },
  { name: "Promax Safety & Health Pvt. Ltd.", city: "Valsad", address: "111 & 111A, New GIDC, Gundlav, Valsad-396035", task_notes: meta("Devaang Mehta","9898135444","devaang.kmehtta@gosafewithpromax.com","","","","Running") },
  { name: "Pure Temptation OPC Pvt. Ltd.", city: "Ahmedabad", address: "Opp. Bombay Textiles, Nr. Tavdipura Post Office, Dudheshwar, Ahmedabad-380004", task_notes: meta("Harsha Gandhi","9825049441","harshagandhi@puretemptation.com","Naresh Vaghela","9998018755","","Running") },
  { name: "Steelcon Impex Pvt. Ltd.", city: "Rajkot", address: "", task_notes: meta("Rohan Kotecha","9879572120","rohan@steelcon.co.in","Bhargav Pandya","9687509059","qa@steelcon.co.in","Reject") },
  { name: "M/S Shanghvi Founders & Engineers Private Limited", city: "Ahmedabad", address: "Rajdhani Bungalows, Near GST Rd, Digvijaynagar, New Ranip, Ahmedabad, Gujarat 382470", task_notes: meta("","9824083931","accounts@shanghvi.com","Priyal Office","9081051133","","concept") },
  { name: "M/S Bindal Silk Mills Pvt Ltd", city: "Surat", address: "Bindal House, Surat - Kadodara Rd, Kumbharia Gam, Surat, Gujarat 395010", task_notes: meta("Ravindra Arya","9909904121","accounts@bindalmill.com","Ravindra Arya","9909018860","ravindra.arya@bindalmill.com","assessment & Visit") },
  { name: "M/S Kadmawala Industries Private Limited", city: "Surat", address: "Plot No.56-57 Shree Krishna IND. Estate, Vill. Tantithaiya, TA. Palsana, Gujarat 394305", task_notes: meta("","9099379444","KESHRINANDANPRINTS@GMAIL.COM","Avdesh Tiwari","7874377112","","assessment & Visit") },
  { name: "M/S Kirtiprada Fashions Private Limited", city: "Surat", address: "Block No 41-42, Vankaneda (B/h Garden Vareli Mill), Kadodara, Surat, Gujarat 394327", task_notes: meta("","9898563000","kirtiprada@gmail.com","Rishan Kurhe","8141228869","","assessment & Visit") },
  { name: "M/S Ravi Exports Limited", city: "Surat", address: "147-162, 1st Floor, Sagar Textile Market, Near Silk City Market, Ring Road, Surat, Gujarat 395002", task_notes: meta("","9825810771","raviexportsltd@gmail.com","Jitu Kumar","9173591672","","assessment & Visit") },
  { name: "M/S Shree Naveen Silk Mills Private Limited", city: "Surat", address: "Plot No 58-59, Survey No 68-70/2, Shivanand Nagar Ind. Estate, Tantithaiya, Tal. Palsana, Dist. Surat, Gujarat 394305", task_notes: meta("","9909999589","shreenaveensilkmills@gmail.com","Abhishek Agarwal","9898567876","abhishekagarwal567@gmail.com","assessment & Visit") },
  { name: "M/S MG Processors Private Limited", city: "Surat", address: "Plot No. 10, Block No. 300/301, Dayabhai Sarpanchni Wadi, Tatithaiya, Kadodara, Gujarat 394305", task_notes: meta("","9825148568","info@mggroupindia.co.in","Murli Sharma (Plant Head)","9909929081","","assessment & Visit") },
  { name: "Agnes Technocast Private Limited", city: "Rajkot", address: "Golden Green Industrial Park, Plot No. 35 to 39, Taluka Lodhika, Khambha, Rajkot, Gujarat 360311", task_notes: meta("","9723034441","agnestechnocastpvtltd@gmail.com","Chintan Patel","9924256001","","assessment & Visit") },
  { name: "M/S Rupkala Engineers Private Limited", city: "Rajkot", address: "Plot G-1313, Road I, Lodhika GIDC, Metoda, Gujarat 360021", task_notes: meta("Viral Panchasara","9924995699","mahendra@rupkalaengineers.com","Viral Panchasara","9824801199","viral@rupkalaengineers.com","assessment & Visit") },
  { name: "Elite Edge Engineering", city: "Rajkot", address: "Ground Floor, 2407/2, Near Centroiid Meditech Pvt. Ltd., Lodhika GIDC, Rajkot, Gujarat 360021", task_notes: meta("Palarajainh Jala","8000070909","palraj.zala98@gmail.com","","","","assessment & Visit") },
  { name: "M/S Aatomize Manufacturing Private Limited", city: "Rajkot", address: "2, Amarnagar, Street No. 1, Near Bahuchar Vidhyalaya, B/h Umakant Pandit Udyognagar, Mahadevwadi, Rajkot, Gujarat 360004", task_notes: meta("Kamlesh Bhai Bhuva","9825153518","cmd@aatomize.com","","","","assessment & Visit") },
  { name: "M/S Gayatri Precision Metals", city: "Jamnagar", address: "Plot no. 4802/02, Phase-3, GIDC, Dared, Jamnagar, Gujarat 361012", task_notes: meta("Vivek Kataria","8128888877","vivek@gayatrigroups.net","Prakash Bhai","8401819191","info@gayatrigroups.net","assessment & Visit") },
  { name: "M/S Shri Panchwati Textiles Industries Private Limited", city: "Surat", address: "Block No. 174 to 189, Swaminarayan Ind. Estate, Surat Bardoli Road, Tatithiya, Tal. Palsana, Surat, Gujarat 394315", task_notes: meta("","9099379444","panchwatimill@yahoo.com","","","","") },
  { name: "M/S Subhash Sarees & Industries Private Limited", city: "Surat", address: "Shop No. 1019 to 1021, 3rd Floor, New Sardar Traders Market, Puna Kumbhariya Road, Surat, Gujarat 395010", task_notes: meta("","9978601066","shobhan@subhashsarees.com","","","","") },
  { name: "M/S Mahadev Turntech Private Limited", city: "Jamnagar", address: "Plot No. 3515, GIDC Phase III, Phase-2, Dared, Jamnagar, Gujarat 361012", task_notes: meta("","9925630723","ACCOUNT@MTURNTECH.COM","","","","") },
  { name: "M/S Western Irrigation System Private Limited", city: "Rajkot", address: "Plot No. 16-21, Shivam Industrial Zone 3, Kalawad Road, Vill. Chhapra, Tal-Lodhika, Dist. Rajkot, Gujarat 360021", task_notes: meta("Deep Tarpar","9825076774","account@westernispl.com","Deep Tarpar","9979890440","westernhdpepipe@rediffmail.com","concept") },
  { name: "SRP Crane Controls (India) Private Limited", city: "Rajkot", address: "Survey No.202, Jaydev Industrial Estate, Plot No.39, Essen Road, Opp. Inova Cast, Veraval, Gujarat 360024", task_notes: meta("","9879995013","director@srpcranecontrols.com","Abhay Bhai","9998871013","","assessment & Visit") },
  { name: "M/S Winsteel Engineering Works Private Limited", city: "Surat", address: "Plot No-I, 68, Rd Number 6, GIDC, Sachin, Surat, Gujarat 394230", task_notes: meta("","9824113977","winsteel@winsteel.in","","","","") },
  { name: "Sunforge Private Limited", city: "Rajkot", address: "Plot No. G-511/512, Kalavad Rd, GIDC Lodhika, Metoda, Rajkot, Gujarat 360021", task_notes: meta("","9824042349","info@sunforgeindia.in","","","","") },
  { name: "M/S Begani Dyeing Mills Pvt Ltd", city: "Surat", address: "5R68+G3P, Uma Bhawan Society, Althan, Surat, Gujarat 395017", task_notes: meta("","9574006827","accbeganidyeing@gmail.com","","","","") },
  { name: "Ghanshyam Engineering Works", city: "Vadodara", address: "490 491/d 1/5, Chandan Complex, GIDC Makarpura, Vadodara, Gujarat 390010", task_notes: meta("","9687223447","uvraulji@gmail.com","","","","") },
  { name: "M/S Trishulrudra Corrugators Private Limited", city: "Vadodara", address: "948R+3XJ, Mahatma Gandhi Rd, Sundervan Society, Karadiya, Vadodara, Gujarat 391310", task_notes: meta("","9898764131","trishulpack@gmail.com","","","","") },
  { name: "M/S Omex Engineering", city: "Rajkot", address: "Plot No. G-2116-2117/A, Gate No. 3, Near Kadvani Forge, GIDC Metoda, Lodhika, Rajkot, Gujarat 360021", task_notes: meta("","9374111730","omexengineering@gmail.com","","","","") },
  { name: "M/S Ravi Brass (India) Private Limited", city: "Jamnagar", address: "Plot No. 270 & 341, Vision Industrial Park, Changa, Jamnagar, Gujarat 361012", task_notes: meta("","9081327555","accounts@ravibrass.com","","","","") },
  { name: "M/S Saiauto & Forge Private Limited", city: "Veraval (Shapar)", address: "", task_notes: meta("","7069264643","rp.saiauto@gmail.com","","","","") },
  { name: "M/S Royal Engineers", city: "Jamnagar", address: "", task_notes: meta("","9898516362","mukesh.savalia@royal-jam.com","","","","") },
  { name: "Pratik Industries", city: "Rajkot", address: "", task_notes: meta("","9824222398","ahiyapratik@gmail.com","","","","") },
  { name: "M/S Aris Global Forging & Machining LLP", city: "Gondal", address: "", task_notes: meta("","9725587206","info@arisglobalforging.com","","","","") },
  { name: "M/S J Cam Engineering Corporation", city: "Rajkot", address: "", task_notes: meta("","7600056737","account@j-camengineering.com","","","","") },
  { name: "M/S Equinox Enermech Limited", city: "Rajkot", address: "", task_notes: meta("","7874737373","equinoxsolarpvtltd2022@gmail.com","","","","") },
  { name: "M/S Gems Technocast", city: "Rajkot", address: "", task_notes: meta("","9978877177","jjautohitesh@gmail.com","","","","") },
  { name: "M/S AES Hydro", city: "Vadodara", address: "", task_notes: meta("","9825713179","info@aeshydro.com","","","","") },
  { name: "M/S Oskar Industries", city: "Rajkot", address: "", task_notes: meta("","8866221646","info@oskovalves.com","","","","") },
  { name: "M/S Fortis Technoforge Private Limited", city: "Gondal", address: "Hadamtala (Shemla), Gondal", task_notes: meta("","7797717917","md@fortistechnoforge.com","","","","") },
  { name: "Y Gen Manufacturing Limited", city: "Rajkot", address: "", task_notes: meta("","9978586007","ygenmanufacturinglimited@gmail.com","","","","") },
  { name: "M/S Digvijay Engineers", city: "Rajkot", address: "", task_notes: meta("","9722777770","digvijayengneers7@gmail.com","","","","") },
  { name: "M/S Aditya Engimach Private Limited", city: "Rajkot", address: "", task_notes: meta("","9879162678","maulikshah@adityainc.com","","","","") },
  { name: "M/S Paani Precision Products LLP", city: "Jamnagar", address: "", task_notes: meta("","9408324979","info@paaniprecisions.com","","","","") },
];

async function seed() {
  const email = process.argv[2];
  const password = process.argv[3];
  if (!email || !password) {
    console.error("Usage: node seed-sites.mjs <manager-email> <manager-password>");
    process.exit(1);
  }
  const { error: authErr } = await supabase.auth.signInWithPassword({ email, password });
  if (authErr) {
    console.error("Sign-in failed:", authErr.message);
    process.exit(1);
  }
  console.log("Signed in as", email);
  console.log(`Inserting ${sites.length} sites...`);

  const rows = sites.map(s => ({
    name: s.name,
    city: s.city || null,
    address: s.address || null,
    task_notes: s.task_notes,
    assigned_worker_id: null,
    appt_date: null,
    appt_time: null,
  }));

  const { data, error } = await supabase.from("sites").insert(rows).select("id,name");

  if (error) {
    console.error("Insert failed:", error.message);
    console.error("Code:", error.code);
    process.exit(1);
  }

  console.log(`✓ Inserted ${data.length} sites successfully`);
  data.forEach(s => console.log(`  - ${s.name} (${s.id})`));
}

seed();
