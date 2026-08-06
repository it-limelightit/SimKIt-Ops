-- Operational factory statuses requested for the Sites dashboard.
-- This updates records imported from the 25-Jul-2026 company status tracker.
-- Other site metadata and any text following the metadata block are preserved.

UPDATE public.sites
SET task_notes = regexp_replace(
  task_notes,
  '"status"\s*:\s*"[^"]*"',
  CASE
    WHEN task_notes LIKE '%"tracker_source_detail": "Bill submission pending"%'
      OR task_notes LIKE '%"tracker_source_detail":"Bill submission pending"%'
      THEN '"status":"Completed but bill pending"'
    ELSE '"status":"Completed/Billed from our end"'
  END
)
WHERE
  task_notes IS NOT NULL
  AND (
    task_notes LIKE '%"status": "Completed & Billed"%'
    OR task_notes LIKE '%"status":"Completed & Billed"%'
  );

UPDATE public.sites
SET task_notes = regexp_replace(
  task_notes,
  '"status"\s*:\s*"[^"]*"',
  '"status":"Completed but awaiting NPC confirmation"'
)
WHERE
  task_notes IS NOT NULL
  AND (
    task_notes LIKE '%"status": "Awaiting NPC Confirmation"%'
    OR task_notes LIKE '%"status":"Awaiting NPC Confirmation"%'
  );

-- The workbook's Pending Assessment/Newly Assigned sheets are authoritative
-- for these nine companies.
UPDATE public.sites
SET task_notes = regexp_replace(
  task_notes,
  '"status"\s*:\s*"[^"]*"',
  '"status":"Pending Assessment"'
)
WHERE lower(btrim(name)) IN (
  lower('M/S MOTEXO INDUSTRIES LLP'),
  lower('M/S LEXICON POLYCRAFT'),
  lower('M/S PATEL METAL TREATMENT'),
  lower('R S COMPOSITE'),
  lower('M/S R S EXIM'),
  lower('SAMURAI PUMPS PRIVATE LIMITED'),
  lower('M/S DOLPHIN POLYMERS'),
  lower('M/S ACTIVE ENTERPRISES'),
  lower('M/S HI WILL ENGINEERING SOLUTION')
);

