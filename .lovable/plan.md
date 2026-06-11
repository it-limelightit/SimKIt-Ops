
# SIM-Kit Ops — Build Plan

A field operations dashboard with three roles (Worker, Supervisor, Owner), three-phase site workflows (Assessment → Installation → Commissioning), photo/file uploads, and a dynamic forms builder. Built on TanStack Start + Lovable Cloud (Supabase under the hood).

## Design system

- Paper background `#F5F4F0`, white surfaces, 1px `#E2E0DA` borders, no shadows, no gradients.
- Accent near-black `#1A1A1A`; stone `#B5A99A`; success/warning/danger as specified.
- Fonts: DM Serif Display (headings), Inter (UI), JetBrains Mono (IDs/times). Loaded via Google Fonts.
- Rectangular buttons (≤4px radius), underline form fields, custom square checkboxes, Lucide icons (stroke 1.5, 18px).
- Tokens defined in `src/styles.css` (oklch), Tailwind utilities via `@theme inline`. Component variants for `button`, `input`, `card`, `tabs`, `checkbox` instead of inline overrides.

## Tech & infra

- TanStack Start (existing template) + TypeScript + Tailwind v4.
- Lovable Cloud enabled — Supabase Auth, Postgres, Storage.
- Forms: react-hook-form + zod. State: Zustand for auth/role. Data: TanStack Query (already in template) for reads.
- Routing: TanStack file routes (not React Router — adapting the spec to the template).
- Server access via `createServerFn` with `requireSupabaseAuth`; admin tasks via `supabaseAdmin` inside server fns.

## Phases of work

### 1. Foundation
- Enable Lovable Cloud.
- Add fonts + design tokens in `src/styles.css`.
- Build primitive components: `Button`, `Input` (underline), `Textarea`, `Checkbox` (custom square), `Card`, `Tabs`, `Badge`, `Toast`, `SegmentedControl`, `EmptyState`, `Skeleton`.
- Zustand `useAuth` store; Supabase client wiring (already present from Cloud).

### 2. Database schema (single migration)
Tables (all in `public`, with GRANTs + RLS):
- `profiles` (id → auth.users, name, email, mobile, whatsapp, is_active, created_at, last_login)
- `user_roles` (separate; enum `app_role` = worker|supervisor|owner) + `has_role()` SECURITY DEFINER
- `sites` (id, name, city, state, address, assigned_worker_id, created_by, created_at)
- `assessment`, `installation`, `commissioning` (site_id, worker_id, data JSONB, updated_at)
- `contacts`, `machines`
- `custom_fields` (phase, section, field_type, label, options jsonb)
- `media` (site_id, phase, section, file_url, file_type, caption, uploaded_by)
- Storage buckets: `site-media` (private), `site-docs` (private). Signed URLs for display.

RLS:
- Worker: read/write only rows where `worker_id = auth.uid()` or `assigned_worker_id = auth.uid()`.
- Supervisor: read all, manage workers/assignments.
- Owner: full access; can manage supervisors.

Trigger: auto-create `profiles` row on `auth.users` insert; default role `worker` (inactive until supervisor activates).

### 3. Auth screens (`/auth`)
- Tab switcher Login | Sign Up.
- Login: role selector cards (Worker/Supervisor/Owner) + mobile + password. Mobile stored as email-alias (`{mobile}@simkit.local`) since Supabase Auth needs email — or capture real email at signup and use it. Decision: use real email at signup; mobile is profile metadata. Login uses email + password (label shown as "Mobile or Email" — accepts both, resolves mobile→email server-side).
- Signup (worker only): full name, email, mobile, whatsapp, password, confirm. Creates inactive account; supervisor must activate.
- Supervisor/Owner: pre-seeded note + small "seed demo accounts" server fn in dev.

### 4. Worker dashboard (`/_authenticated/worker`)
- Header: assigned site, city, assigned date, overall progress bar.
- Three tabs (underline indicator):
  - **Assessment** — 11 sections as cards (factory call, third-party call, appointment, facility visit, explanation, contacts repeater, floor visit + photos, business profile, machines repeater, MOM upload, media upload).
  - **Installation** — delivery confirmation, coordination, photos.
  - **Commissioning** — 6 numbered steps, certificate email (server fn → Lovable email infra later or stubbed for now with `email queued`), final MOM.
- Auto-save on blur (debounced server fn write into the JSONB column).
- Subtle "Saved" toast bottom-right.
- Offline banner via `navigator.onLine` listener.
- Per-tab completion %, overall % aggregated.

### 5. Supervisor dashboard (`/_authenticated/supervisor`)
- Sidebar (`#1A1A1A`, 240px): Overview, Sites, Workers, Forms Builder, Reports + Profile/Logout.
- Overview: stat cards + sites table (sortable). Row click → read-only site detail.
- Workers: list, activate/deactivate, assign-to-site dialog.
- Forms Builder: select phase + section → add custom fields; rendered dynamically in worker forms by reading `custom_fields` and merging into the section UI.
- Reports: filters + CSV export (client-side from query results).

### 6. Owner dashboard (`/_authenticated/owner`)
- Same chrome as supervisor + Team tab (manage supervisors) + Settings (company name, logo upload, default city list stored in a `settings` singleton row).

### 7. Server functions
- `auth.functions.ts` — signUpWorker, resolveLogin (mobile→email), activateWorker.
- `sites.functions.ts` — list/create/assign/get with role gating via `requireSupabaseAuth`.
- `phase.functions.ts` — savePhaseData (assessment/installation/commissioning), getSiteFull.
- `media.functions.ts` — signed upload URL, list media, delete.
- `custom-fields.functions.ts` — CRUD.
- `reports.functions.ts` — filtered query for CSV.

### 8. Polish
- Skeletons for all loading states.
- Empty states (Lucide icon + 1 line).
- Mobile-first worker forms (390px); desktop-first dashboards with collapsible sidebar on mobile.
- `sitemap.xml` + `robots.txt` (mostly disallow since app is private; allow `/` and `/auth`).

## Out of scope for v1 (callouts)
- Real outbound email for completion certificate — wired as a server fn that stores the request in a `certificate_emails` table; sending requires Lovable Emails domain setup, which I'll mention after build.
- Push notifications, SMS, true offline sync (only banner + queued auto-save while online).

## Order of execution
1. Enable Cloud, write migration, seed roles/buckets.
2. Design tokens + primitive components.
3. Auth pages + auth store + role-aware redirect.
4. Worker dashboard skeleton + Assessment tab end-to-end (proves the pattern).
5. Installation + Commissioning tabs.
6. Supervisor dashboard (Overview → Sites → Workers → Forms Builder → Reports).
7. Owner dashboard additions (Team, Settings).
8. Polish, empty/loading/offline states, sitemap.

This is a large build — I'll work through it in that order and ship continuously so you can review as it goes.
