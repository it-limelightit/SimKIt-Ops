# Commissioning setup and UI test

Updated 17 November 2026.

## Current setup

Google Drive is connected to the existing it@limelight.io evidence folders. Supabase migrations and commissioning-drive-check are deployed to project jhhiwyvrhfhvvougkqmm. Automatic commissioning is enabled for new eligible sites. Activation excluded 103 historical sites; changing an old company's visible status does not make it eligible again.

The local verification worker and free OCR/media tools are installed. This PC must remain on and connected. After a reboot, start the worker using scripts/start-commissioning-worker.ps1. Automatic Windows startup is not configured.

Local frontend preview: http://127.0.0.1:8080/. Frontend changes have not been published to the production website.

For the total-duration update, run the updated verification worker before applying `20261120120000_commissioning_video_total.sql` and deploying `commissioning-drive-check`. Publish the updated frontend after the backend is available.

## Still required before a real approval

Provide the approved completed-letter example, expected logo/letterhead and authorized names/designations. No trusted company letter policies have been supplied or invented. Until configured, the UI reports: Letter verification needs setup. Contact manager.

The authority check compares OCR text with approved names/designations. It does not authenticate handwritten signatures. Logo matching needs a calibrated approved reference. Full letter checks accept PDF or readable PNG/JPEG/WebP. Convert completed Word certificates to PDF first.

## UI flow

1. Use a fresh eligible company and complete installation and the commissioning checklist.
2. Keep at least four unique readable photos and at least 120 seconds of video across the unique readable clips inside the company folder. Keep one completed letter in its letter folder or company root.
3. Select **Verify and commission**. The system finds the company folder by name; a manual Drive URL is unnecessary.
4. The worker reads files directly from Drive, checks readable media and actual video duration, scans the letter, verifies configured fields and logo, then rechecks the evidence manifest.
5. Only all checks passing permits automatic commissioning. Failure leaves the company uncommissioned and displays a short red message.

Manual commissioning-request and manager-review controls are removed. An internal request record remains for the existing audit/earnings logic. New verifier-backed requests cannot be approved or rejected through the old manual review action.

Historical submitted/commissioned dates and existing earnings/payment records are protected. New successful approvals record their own verification/approval time. Reverting an old company's status does not reset its history; use a fresh company for testing.

## Validation and limits

49 backend/rule/field-operation tests and the production build passed. A synthetic native-tool smoke test passed readable media, OCR, logo comparison and manifest checks, and rejected a wrong logo and a misleading long audio tail. This is not a real-company approval: approved letter references remain required.

Local open-source tools avoid a paid OCR/AI endpoint. Existing Supabase/Drive quotas, internet and PC running costs still apply. Worker limits include 100 MB per file, 512 MB per attempt, five letter pages and bounded folder traversal. Offline workers and timeouts never cause approval.

Credentials and references remain in ignored local files or Supabase secrets. The browser receives neither service-role keys nor Google private keys. The worker obtains short-lived read-only Drive tokens from the backend.

See [the verifier guide](../integrations/commissioning-verifier/README.md) for certificate policy fields and operational details.
