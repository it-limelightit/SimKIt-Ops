-- Import: SIM_Kit_Project_Company_Status_Tracker_25-Jul-2026.xlsx
-- 51 unique companies: 32 active + 19 completed/billed.
-- Blank workbook fields are intentionally stored as NULL / empty metadata values.

CREATE TEMP TABLE tracker_sites (
  name text PRIMARY KEY,
  mobile text,
  city text,
  address text,
  status text,
  source_section text,
  source_detail text
) ON COMMIT DROP;

INSERT INTO tracker_sites (name, mobile, city, address, status, source_section, source_detail) VALUES
('Y GEN MANUFACTURING LIMITED','9978586007','RAJKOT',NULL,'Awaiting NPC Confirmation','Active Companies','Completed'),
('M/S SHANGHVI FOUNDERS & ENGINEERS','9824083931','AHMEDABAD',NULL,'Pending Installation','Active Companies',NULL),
('M/S PURE TEMPTATION PRIVATE LIMITED','9825049441','AHMEDABAD',NULL,'Awaiting NPC Confirmation','Active Companies','Completed'),
('GHANSHYAM ENGINEERING WORKS','9687223447','VADODARA',NULL,'Pending Installation','Active Companies',NULL),
('M/S RAVI EXPORTS LIMITED','9825810771','SURAT',NULL,'Pending Installation','Active Companies',NULL),
('M/S STEELCON IMPEX PRIVATE LIMITED','9879572120','RAJKOT',NULL,'Pending Installation','Active Companies',NULL),
('M/S MG PROCESSORS PRIVATE LIMITED','9825148568','RING ROAD',NULL,'Pending Installation','Active Companies',NULL),
('M/S SAIAUTO & FORGE PRIVATE LIMITED','7069264643','VERAVAL (SHAPAR)',NULL,'Pending Installation','Active Companies',NULL),
('M/S LEXICON POLYCRAFT','9909172242','RAJKOT','Plot No. 04-C, Survey No. 236, Near Vikas Stove, Veraval-Shapar, Rajkot, Gujarat - 360024','Awaiting NPC Confirmation','Active Companies',NULL),
('M/S DOLPHIN POLYMERS','9824766759','DHORAJI','Plot No. 46, GIDC Vegdi, Jamkandorna Road, Dhoraji, Rajkot, Gujarat - 360410','Awaiting NPC Confirmation','Active Companies',NULL),
('M/S SUBHASH SAREES & INDUSTRIES PRIVATE LIMITED','9978601066','SURAT',NULL,'Pending Installation','Active Companies',NULL),
('M/S BEGANI DYEING MILLS PVT LTD','9574006827','SURAT',NULL,'Awaiting NPC Confirmation','Active Companies',NULL),
('M/S MOTEXO INDUSTRIES LLP','9662703393','RAJKOT','Khodiyar Industrial Area, Street No. 2, Near Last Railway Crossing, Rajkot, Gujarat - 360002','Awaiting NPC Confirmation','Active Companies',NULL),
('M/S OMEX ENGINEERING','9374111730','RAJKOT',NULL,'Awaiting NPC Confirmation','Active Companies',NULL),
('M/S KIRTIPRADA FASHIONS PRIVATE LIMITED','9898563000','DIST. SURAT',NULL,'Pending Installation','Active Companies',NULL),
('M/S DIGVIJAY ENGINEERS','9722777770','RAJKOT',NULL,'Awaiting NPC Confirmation','Active Companies','Completed'),
('M/S SHRI PANCHWATI TEXTILES INDUSTRIES','9099379444','SURAT',NULL,'Pending Installation','Active Companies',NULL),
('M/S KADMAWALA INDUSTRIES PRIVATE LIMITED','9099379444','SURAT',NULL,'Pending Installation','Active Companies',NULL),
('SUNFORGE PRIVATE LIMITED','9824042349','METODA',NULL,'Pending Installation','Active Companies',NULL),
('SAMURAI PUMPS PRIVATE LIMITED','9426719336','LODHIKA','Plot No. 179, Subh Industrial Zone, Khambha, Lodhika, Rajkot, Gujarat - 360311','Awaiting NPC Confirmation','Active Companies',NULL),
('M/S WINSTEEL ENGINEERING WORKS','9824113977','SURAT',NULL,'Pending Installation','Active Companies',NULL),
('M/S HI WILL ENGINEERING SOLUTION','9825910029','RAJKOT, GUJARAT','Plot No. 1, National Highway 8B, Shapar-Veraval, Kotda Sangani, Rajkot, Gujarat','Awaiting NPC Confirmation','Active Companies',NULL),
('M/S BINDAL SILK MILLS PVT LTD','9909904121','SURAT',NULL,'Pending Installation','Active Companies',NULL),
('R S COMPOSITE','9913702442','RAJKOT','Plot No. 6, Survey No. 127/P1/P2, Lothada, Pavitra Industrial Area, Rajkot, Gujarat - 360024','Pending Installation','Active Companies',NULL),
('M/S ROYAL ENGINEERS','9898516362','JAMNAGAR',NULL,'Pending Installation','Active Companies',NULL),
('M/S EQUINOX ENERMECH LIMITED','7874737373','RAJKOT',NULL,'Awaiting NPC Confirmation','Active Companies','Completed'),
('M/S J CAM ENGINEERING CORPORATION','7600056737','RAJKOT',NULL,'Awaiting NPC Confirmation','Active Companies','Completed'),
('M/S PATEL METAL TREATMENT','9998383589','RAJKOT','Plot No. 7, Padavala, Tal. Kotda Sangani, Rajkot, Gujarat - 360024','Awaiting NPC Confirmation','Active Companies',NULL),
('M/S ACTIVE ENTERPRISES','9377179608','JAMNAGAR','Plot No. 704, Phase-II, GIDC, Dared, Jamnagar, Gujarat - 361004','Awaiting NPC Confirmation','Active Companies',NULL),
('M/S R S EXIM','9913702442','KOTDA SANGANI','Sub Plot No. 2/3, Sardar Industrial Area, Padavala-Shapar Road, Kotda Sangani, Rajkot, Gujarat - 360030','Pending Installation','Active Companies',NULL),
('ELITE EDGE ENGINEERING','8000070909','TAL-LODHIKA',NULL,'Awaiting NPC Confirmation','Active Companies','Completed'),
('M/S SHREE NAVEEN SILK MILLS PVT. Ltd.','9909999589','SURAT',NULL,'Pending Installation','Active Companies',NULL),
('PROMAX SAFETY & FIRE SERVICES','9898135444','VALSAD',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('DEEPAK CELLULOSE PRIVATE LIMITED','9840901136','GUNDLAV',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S FORTIS TECHNOFORGE PRIVATE LIMITED','7797717917','HADAMTALA (SHEMLA), GONDAL',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S TRISHULRUDRA CORRUGATORS PRIVATE LIMITED','9898764131','VADODARA',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S WESTERN IRRIGATION SYSTEM PRIVATE LIMITED','9825076774','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S RAVI BRASS (INDIA) PRIVATE LIMITED','9081327555','JAMNAGAR',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S ARIS GLOBAL FORGING & MACHINING LLP','9725587206','GONDAL',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S PAANI PRECISION PRODUCTS LLP','9408324979','JAMNAGAR',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S RUPKALA ENGINEERS PRIVATE LIMITED','9924995699','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S MAHADEV TURNTECH PRIVATE LIMITED','9925630723','JAMNAGAR',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('AGNES TECHNOCAST PRIVATE LIMITED','9723034441','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S AATOMIZE MANUFACTURING PRIVATE LIMITED','9825153518','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('SRP CRANE CONTROLS (INDIA) PRIVATE LIMITED','9879995013','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S GEMS TECHNOCAST','9978877177','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission pending'),
('M/S GAYATRI PRECISION METALS','8128888877','JAMNAGAR',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('PRATIK INDUSTRIES','9824222398','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S AES HYDRO','9825713179','VADODARA',NULL,'Completed & Billed','Completed & Billed','Bill submission completed'),
('M/S OSKAR INDUSTRIES','8866221646','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission pending'),
('M/S ADITYA ENGIMACH PRIVATE LIMITED','9879162678','RAJKOT',NULL,'Completed & Billed','Completed & Billed','Bill submission pending');

-- Match exact workbook names first. For legacy rows whose naming changed, use
-- the phone only when that phone occurs once in this workbook.
WITH phone_counts AS (
  SELECT mobile, count(*) AS n FROM tracker_sites GROUP BY mobile
),
matched AS (
  SELECT DISTINCT ON (t.name)
    t.*,
    s.id
  FROM tracker_sites t
  LEFT JOIN phone_counts pc ON pc.mobile = t.mobile
  LEFT JOIN public.sites s ON
    lower(btrim(s.name)) = lower(btrim(t.name))
    OR regexp_replace(lower(s.name), '(m/s|private|pvt|limited|ltd|[^a-z0-9])', '', 'g')
       = regexp_replace(lower(t.name), '(m/s|private|pvt|limited|ltd|[^a-z0-9])', '', 'g')
    OR (
      pc.n = 1
      AND COALESCE(
        substring(s.task_notes FROM '"c1_mobile":"([^"]*)"'),
        substring(s.task_notes FROM '"assessor_phone":"([^"]*)"')
      ) = t.mobile
    )
  ORDER BY t.name, (lower(btrim(s.name)) = lower(btrim(t.name))) DESC
)
UPDATE public.sites s
SET
  name = m.name,
  company_name = m.name,
  city = NULLIF(m.city, ''),
  address = NULLIF(m.address, ''),
  appt_date = NULL,
  appt_time = NULL,
  task_notes = '[METADATA:' || jsonb_build_object(
    'c1_name', '',
    'c1_mobile', COALESCE(m.mobile, ''),
    'c1_email', '',
    'c2_name', '',
    'c2_mobile', '',
    'c2_email', '',
    'status', COALESCE(m.status, ''),
    'create_drive_folder', false,
    'drive_folder_name', '',
    'drive_folder_link', '',
    'visit_status', '',
    'worker_ids', '[]'::jsonb,
    'assessor_company', '',
    'assessor_phone', '',
    'assessor_city', '',
    'assessor_number', '',
    'assessor_email', '',
    'assessor_address', '',
    'tracker_source_section', COALESCE(m.source_section, ''),
    'tracker_source_detail', COALESCE(m.source_detail, '')
  )::text || ']',
  consultant_stage = NULL
FROM matched m
WHERE s.id = m.id;

INSERT INTO public.sites (
  name, company_name, city, address, assigned_worker_id,
  task_notes, appt_date, appt_time, consultant_stage
)
SELECT
  t.name,
  t.name,
  NULLIF(t.city, ''),
  NULLIF(t.address, ''),
  NULL,
  '[METADATA:' || jsonb_build_object(
    'c1_name', '',
    'c1_mobile', COALESCE(t.mobile, ''),
    'c1_email', '',
    'c2_name', '',
    'c2_mobile', '',
    'c2_email', '',
    'status', COALESCE(t.status, ''),
    'create_drive_folder', false,
    'drive_folder_name', '',
    'drive_folder_link', '',
    'visit_status', '',
    'worker_ids', '[]'::jsonb,
    'assessor_company', '',
    'assessor_phone', '',
    'assessor_city', '',
    'assessor_number', '',
    'assessor_email', '',
    'assessor_address', '',
    'tracker_source_section', COALESCE(t.source_section, ''),
    'tracker_source_detail', COALESCE(t.source_detail, '')
  )::text || ']',
  NULL,
  NULL,
  NULL
FROM tracker_sites t
WHERE NOT EXISTS (
  SELECT 1 FROM public.sites s WHERE lower(btrim(s.name)) = lower(btrim(t.name))
);
