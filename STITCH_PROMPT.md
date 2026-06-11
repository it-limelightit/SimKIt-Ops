# Google Stitch AI Prompt — SIM-Kit Field Ops (Next.js)
## FUNKY DARK-MODE DESIGN — NOT A GENERIC DASHBOARD

---

## PROJECT OVERVIEW

Build **SIM-Kit Field Ops** — a full-stack, mobile-first field operations management platform for IoT (SIM-Kit device) deployment teams. Three user tiers: **Owners** (admins), **Managers** (supervisors), **Business Consultants** (field workers). The platform tracks every step of a SIM-Kit device rollout across three sequential phases: **Assessment Visit → Installation → Commissioning**.

### The Vibe
**Dark, electric, alive.** This is NOT a generic SaaS dashboard with rounded cards and blue buttons. This is a **bold, opinionated field-ops tool** that looks like it was designed by a creative studio that also builds street-wear brands. Think: dark base, electric lime accents, oversized typography, chunky borders, kinetic energy. Every screen should feel like it has *personality*.

Inspired by: Vercel's dark aesthetic × Lemon Squeezy's playfulness × Linear's sharp precision — but more expressive and more fun.

---

## TECH STACK

- **Framework**: Next.js 14 (App Router, TypeScript)
- **Database**: Supabase (PostgreSQL + Auth + Realtime + Storage)
- **Styling**: Tailwind CSS v3 with full custom design tokens
- **UI Primitives**: Radix UI
- **State**: Zustand (auth store)
- **Forms**: React Hook Form + Zod
- **Icons**: Lucide React
- **Notifications**: Sonner (toasts — styled dark)
- **Charts**: Recharts (custom styled, no default colors)
- **Fonts**: `Syne` (display/headings) + `Space Grotesk` (body) + `Space Mono` (data/labels)
- **File Storage**: Supabase Storage buckets (`site-media`, `site-docs`)
- **CSV Export**: Papa Parse

---

## DESIGN SYSTEM — ELECTRIC DARK

### Color Palette

```css
:root {
  /* Base */
  --bg:            #08080F;   /* near-black with blue-black tint — main background */
  --surface:       #0F0F1A;   /* dark card surface */
  --surface-raised: #161625;  /* elevated card / modal */
  --border:        #1E1E2E;   /* subtle dark border */
  --border-bright: #2E2E45;   /* hover border */

  /* Text */
  --text-primary:  #F0ECE3;   /* warm cream white — primary text */
  --text-secondary:#8B8799;   /* muted lavender-gray */
  --text-dim:      #4A4860;   /* very muted, placeholder */

  /* Electric Accents */
  --lime:          #C8FF4A;   /* electric lime — PRIMARY ACCENT — buttons, active, highlights */
  --lime-dim:      #1A2A00;   /* lime dark bg for lime-toned badges */
  --coral:         #FF5533;   /* hot coral-orange — warnings, danger actions, hot states */
  --coral-dim:     #2A0E08;   /* coral dark bg */
  --violet:        #9B7FFF;   /* soft electric violet — links, info, secondary actions */
  --violet-dim:    #150E2A;   /* violet dark bg */
  --mint:          #3DFFC0;   /* neon mint — success / done states */
  --mint-dim:      #002A1A;   /* mint dark bg */

  /* Functional */
  --success:       #3DFFC0;   /* mint green — done */
  --warning:       #FFB830;   /* amber — in progress */
  --danger:        #FF5533;   /* coral — errors, delete */
  --primary:       #C8FF4A;   /* lime — main CTA */
  --primary-fg:    #08080F;   /* black on lime buttons */
}
```

### Fonts

```html
<!-- In <head> -->
<link href="https://fonts.googleapis.com/css2?family=Syne:wght@400;600;700;800&family=Space+Grotesk:wght@300;400;500;600&family=Space+Mono:wght@400;700&display=swap" rel="stylesheet">
```

| Role | Font | Weight | Notes |
|------|------|--------|-------|
| Display / H1 | `Syne` | 800 | Massive, wide, editorial |
| H2 / H3 | `Syne` | 700 | Bold, tight letter-spacing |
| Body | `Space Grotesk` | 400/500 | Slightly quirky, readable |
| Labels / Tags | `Space Mono` | 400 | ALL CAPS, monospace chips |
| Numbers / Data | `Space Mono` | 700 | Big stat numbers, completion % |

### Typography Scale

```css
h1  { font: 800 3.5rem/1 Syne; letter-spacing: -0.03em; color: var(--text-primary); }
h2  { font: 700 2rem/1.1 Syne; letter-spacing: -0.02em; }
h3  { font: 700 1.25rem/1.3 Syne; }
p   { font: 400 0.9375rem/1.6 'Space Grotesk'; color: var(--text-secondary); }
.mono-label { font: 400 0.65rem/1 'Space Mono'; text-transform: uppercase; letter-spacing: 0.12em; color: var(--text-dim); }
.stat-number { font: 700 3.5rem/1 'Space Mono'; color: var(--text-primary); }
```

### Spatial System

```
Border radius:   6px (sm), 10px (md), 16px (lg), 9999px (pill)
Card padding:    1.5rem (mobile), 2rem (desktop)
Border width:    1.5px default, 2px on focus/hover
Gutter:          1.5rem (mobile), 2rem (desktop)
Sidebar width:   260px (desktop)
Max content:     1440px centered
```

### Component Signatures

**Button — Primary (Lime)**
```
bg: --lime | text: --primary-fg (black) | font: Space Grotesk 600
border-radius: 6px | padding: 12px 24px
hover: brightness(1.1) + slight scale(1.02)
active: scale(0.98)
NO SHADOW — flat and bold
```

**Button — Secondary**
```
bg: transparent | border: 1.5px var(--border-bright) | text: --text-primary
hover: border-color --lime/40, text --lime
```

**Button — Ghost**
```
bg: transparent | text: --text-secondary
hover: text --text-primary, bg var(--surface)
```

**Button — Danger**
```
bg: transparent | border: 1.5px var(--coral)/40 | text: var(--coral)
hover: bg var(--coral-dim)
```

**Input / Textarea**
```
bg: var(--surface) | border: 1.5px var(--border)
border-radius: 6px | font: Space Grotesk 400
color: var(--text-primary)
placeholder: var(--text-dim)
focus: border-color var(--lime), box-shadow 0 0 0 3px var(--lime)/15
NO underline-only style — full-border dark inputs
padding: 10px 14px
```

**Select**
```
Same as Input + chevron-down icon in text-dim
```

**Checkbox**
```
16x16 square, border: 2px var(--border-bright), radius: 4px
checked: bg var(--lime), border var(--lime), black checkmark icon
label: Space Grotesk 400, text-primary, 14px
```

**Badge / Tag**
```
font: Space Mono 400, 10px, uppercase, letter-spacing 0.1em
padding: 3px 8px, border-radius: 4px (almost flat pill)
4 variants:
  done:    text --mint,   bg --mint-dim,  border --mint/20
  pending: text --warning, bg rgba(255,184,48,0.08), border --warning/20
  active:  text --violet, bg --violet-dim, border --violet/20
  danger:  text --coral,  bg --coral-dim,  border --coral/20
```

**Card**
```
bg: var(--surface) | border: 1.5px var(--border)
border-radius: 10px | padding: 1.5rem–2rem
NO box-shadow — flat, dark, bordered
On hover (interactive cards): border-color var(--border-bright)
```

**SectionTitle (numbered)**
```
Layout: flex row, gap 12px, align items-baseline
Number: Space Mono 700, 0.7rem, var(--lime), opacity 0.6
Title: Syne 700, 1.1rem, var(--text-primary)
Bottom border: 1.5px var(--border), margin-bottom 1.25rem
```

**ProgressBar**
```
height: 6px (thicker than generic)
bg track: var(--border)
fill: linear-gradient(90deg, var(--lime), var(--mint))
border-radius: 9999px
animated: CSS width transition 600ms ease-out
```

**Segmented Control**
```
bg: var(--surface) | border: 1.5px var(--border) | border-radius: 8px
Option button: Space Grotesk 500, 13px, padding 8px 16px
Active option: bg var(--lime), text black, border-radius 6px
Inactive: text var(--text-secondary)
Smooth transition on active change
```

**EmptyState**
```
centered, py-16
Icon: 48px, color var(--text-dim)
Text: Space Grotesk 400, 14px, var(--text-dim)
```

**Skeleton**
```
bg: var(--surface-raised)
animated shimmer via CSS gradient animation
border-radius: 6px
```

---

## UNIQUE UI PATTERNS (NON-GENERIC)

### 1. Phase Progress — Segmented Bar (NOT a thin line)

At the top of the consultant page, show three chunky horizontal segments:

```
[██████████ ASSESSMENT 82%] [████░░░░░░ INSTALLATION 30%] [░░░░░░░░░░ COMMISSIONING 0%]
```

Each segment:
- Height: 48px
- Background: var(--surface) with border
- Fill: lime-to-mint gradient from left, width = completion%
- Text inside the bar: "ASSESSMENT · 82%" in Space Mono, white on dark part, black on light part
- Active phase: lime border (2px)
- Mobile: stack vertically

### 2. Section Cards — Left Accent Bar

Every section card has a 3px left border accent in lime color:

```
┃  01 Factory Call                [DONE ✓]
┃  ────────────────────────────────────────
┃  ☑ Complete the job
```

Left border: `border-left: 3px solid var(--lime)`

### 3. "Complete the Job" — Achievement Style

Don't make it look like a boring checkbox. Style it like an achievement unlock:

```
┌─────────────────────────────────────────┐
│  ⬡  COMPLETE THE JOB          [UNLOCK] │
│     Mark this section as done           │
└─────────────────────────────────────────┘
```

When NOT checked: border is var(--border-bright), bg transparent, text muted
When checked: border var(--lime), bg var(--lime-dim), text var(--lime), left icon fills lime

It's a full-width row component, not just a checkbox + label.

### 4. Stat Cards — Oversized Mono Numbers

```
┌──────────────────┐
│  14              │
│  TOTAL SITES     │
│                  │
│  ↑ 3 this week   │
└──────────────────┘
```

The "14" is in Space Mono 700, 3.5rem, --text-primary
Label: Space Mono uppercase, tiny, --text-dim
Trend: small inline badge (green up / coral down)

### 5. Sidebar Navigation — Lime Active State

```
SIM-KIT OPS ──── [logo mark]
MANAGER

  ⬡ Overview          ← active: lime dot + lime text + lime left border
  ○ Sites
  ○ Business Consultants
  ○ Performance
  ○ Reports

──────────────────────
  Tirthh Thakar
  [→ Sign Out]
```

Active nav item: `border-left: 3px solid var(--lime)`, text var(--lime), bg rgba(lime, 0.05)
Inactive: text var(--text-secondary), no border

### 6. Pipeline Funnel — Horizontal Bold Bars

Each pipeline stage is a horizontal bar, full-width, with decreasing opacity or count-based width:

```
UNASSIGNED ──────────────────────────────── 24 sites
SCHEDULED  ─────────────────────────── 18 sites
ASSESSMENT ──────────────────── 11 sites
INSTALLATION ────────────── 7 sites
COMMISSIONING ───────── 4 sites
DONE ─────── 2 sites
```

Each bar: bg var(--lime) at different opacities (1.0 → 0.15), height 8px, label left mono text, count right mono text
Bold visual hierarchy, NOT a chart library default

### 7. Performance Accordion — Bold Rows

```
▶ RAJESH KUMAR ──────────── 3 SITES ──── AVG 64%
  ┌─ Infosys Bengaluru ────────────────────────────┐
  │  Assessment [████████░░] 80%                   │
  │  Installation [████░░░░░░] 40%                 │
  │  Commissioning [░░░░░░░░░░] 0%                 │
  └────────────────────────────────────────────────┘
```

### 8. Form Section Numbers — Ghost Background

Each section gets its number as a massive ghost watermark:

```css
.section-number-ghost {
  position: absolute;
  top: -10px;
  right: 16px;
  font: 700 7rem/1 'Space Mono';
  color: var(--lime);
  opacity: 0.04;
  pointer-events: none;
  user-select: none;
}
```

### 9. Thank You Screen — Electric Celebration

Full-screen takeover:
- Background: `radial-gradient(circle at center, #1A2A00 0%, #08080F 70%)`
- Center: pulsing lime circle with checkmark (animated scale pulse)
- "THANK YOU" in Syne 800, 5rem, var(--lime)
- Subtext in Space Grotesk, cream
- Four small animated lime particles/dots floating upward
- Sign Out button in lime

### 10. Toast Notifications

Dark themed:
```
bg: var(--surface-raised) | border: 1.5px var(--border-bright) | text: var(--text-primary)
Success: left border 3px var(--mint) + mint dot
Error: left border 3px var(--coral) + coral dot
Font: Space Grotesk 400, 14px
```

---

## DATABASE SCHEMA

### Tables

```sql
-- profiles
id uuid PRIMARY KEY,
name text,
email text,
mobile text,
is_active boolean DEFAULT false,
last_login timestamptz,
created_at timestamptz DEFAULT now()

-- user_roles
id uuid PRIMARY KEY,
user_id uuid REFERENCES auth.users,
role text CHECK (role IN ('worker', 'supervisor', 'owner'))

-- sites
id uuid PRIMARY KEY,
name text NOT NULL,
address text,
city text,
state text,
assigned_worker_id uuid REFERENCES profiles(id),
assigned_at timestamptz,
appt_date date,
appt_time time,
task_notes text,           -- format: [PHASE:assessment]notes text
task_assigned_at timestamptz,
task_assigned_by uuid,
created_by uuid,
created_at timestamptz DEFAULT now()

-- assessment (one-to-one with sites)
id uuid PRIMARY KEY,
site_id uuid UNIQUE REFERENCES sites(id),
worker_id uuid REFERENCES profiles(id),
data jsonb,
updated_at timestamptz

-- installation (one-to-one with sites)
id uuid PRIMARY KEY,
site_id uuid UNIQUE REFERENCES sites(id),
worker_id uuid,
data jsonb,
updated_at timestamptz

-- commissioning (one-to-one with sites)
id uuid PRIMARY KEY,
site_id uuid UNIQUE REFERENCES sites(id),
worker_id uuid,
data jsonb,
updated_at timestamptz

-- contacts (many per site)
id uuid PRIMARY KEY,
site_id uuid REFERENCES sites(id),
name text,
designation text,
mobile text,
email text,
created_at timestamptz DEFAULT now()

-- machines (many per site)
id uuid PRIMARY KEY,
site_id uuid REFERENCES sites(id),
name text,
brand text,
model text,
serial text,
year integer,
condition text CHECK (condition IN ('Good', 'Average', 'Poor')),
created_at timestamptz DEFAULT now()

-- media
id uuid PRIMARY KEY,
site_id uuid REFERENCES sites(id),
phase text,
section text,
file_path text,
file_name text,
file_type text,
size_bytes integer,
caption text,
uploaded_by uuid,
created_at timestamptz DEFAULT now()

-- custom_fields
id uuid PRIMARY KEY,
phase text,
section text,
label text,
field_type text CHECK (field_type IN ('Text','Number','Textarea','Dropdown','Checkbox','File Upload')),
options jsonb,             -- { worker_id: "all"|uuid, values: string[] }
created_by uuid,
created_at timestamptz DEFAULT now()

-- settings
id uuid PRIMARY KEY,
company_name text,
default_cities jsonb,
logo_path text,
updated_at timestamptz
```

### Phase Data JSON Keys (used for completion %)

**Assessment — 11 boolean keys:**
`factory_call_done, third_party_call_done, appointment_saved, facility_visit_done, explanation_saved, contacts_done, floor_visit_done, business_profile_saved, machines_done, mom_uploaded, media_uploaded`

**Installation — 3 boolean keys:**
`delivery_confirmed, coordination_done, photos_uploaded`

**Commissioning — 8 boolean keys:**
`coordination_done, visit_done, connection_done, configure_done, testing_done, screenshots_uploaded, certificate_sent, final_mom_uploaded`

---

## AUTH & ROLES

| Role | UI Label | Access |
|------|----------|--------|
| `owner` | Owner | Everything — managers + forms builder + settings |
| `supervisor` | Manager | Sites, tasks, consultants, performance, reports |
| `worker` | Business Consultant | Assigned site + 3 phases only |

**Auth Flow:**
1. Sign Up → pick role (worker or manager) → email + password
2. `is_active: false` on creation → blocked with "Awaiting Approval" screen
3. Worker approved by Manager; Manager approved by Owner
4. Supabase JWT → Zustand store manages client auth state

**Zustand Auth Store:**
```ts
interface AuthState {
  ready: boolean
  userId: string | null
  email: string | null
  role: 'worker' | 'supervisor' | 'owner' | null
  profile: { name: string; is_active: boolean; mobile?: string } | null
  signOut: () => Promise<void>
  refresh: () => Promise<void>
}
```

---

## ROUTES & PAGES

```
/ → redirect /auth
/auth
/business-consultant
/manager, /manager/sites, /manager/tasks
/manager/business-consultants, /manager/performance, /manager/reports
/owner (same as manager + extras)
/owner/managers, /owner/forms, /owner/settings
```

---

## PAGE-BY-PAGE SPECIFICATIONS

---

### `/auth` — Authentication

**Layout:**
- Full viewport, dark bg (--bg)
- Left 45% (desktop only): Dark panel with:
  - Top-left: logo mark — a geometric hexagon/diamond shape in lime + "SIM-KIT OPS" in Syne 800
  - Center: large Syne 800 headline: "Field Ops,\nReimagined." in --text-primary, line 2 in --lime
  - Bottom: tagline in Space Grotesk, small, --text-dim: "Track every phase. Close every deal."
  - Subtle dot-grid background pattern (SVG, very faint --border color dots)
- Right 55%: slightly lighter dark bg (--surface), form centered

**Tabs:** "Sign In" / "Sign Up" — pill switcher in lime

**Sign In:**
- Email input (dark styled)
- Password input + show/hide toggle (eye icon in --text-dim)
- "Sign In →" primary lime button, full width
- Below button: "Don't have an account? Sign up"

**Sign Up:**
- Full Name
- Email
- Password
- Role selector — two large cards side by side:
  - **Business Consultant** card: icon (Briefcase), title, description "I do fieldwork"
    - Unselected: --surface, --border
    - Selected: --lime-dim, border-lime, lime icon
  - **Manager** card: icon (BarChart3), "I manage the team"
    - Same selection style
- "Create Account →" primary lime button

**Pending Approval:**
- Centered card (--surface-raised, border --border-bright)
- Large clock icon in --warning (amber)
- "Awaiting Approval" in Syne 700
- "Your account is pending activation. A manager will approve you shortly." in Space Grotesk
- "Sign Out" ghost button

**Mobile:** Single column, logo top center, form below

---

### `/business-consultant` — Field Consultant

**Top Bar:**
- Sticky, bg --surface, border-bottom --border, height 56px
- Left: "SIM-KIT OPS" in Syne 700, --lime
- Right: consultant name chip (Space Mono, small) + sign out button

**No Site / Not Active:** Centered card states (as described in auth)

**Active Site — Header Section:**
```
ACTIVE SITE                           [OVERALL 54%]
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
INFOSYS BENGALURU                     [location pin] Bengaluru
Assigned 15 Jan 2025

┌─ APPOINTMENT ────────────────────────────────┐
│  MON, 20 JAN · 10:00 AM                     │
│  "Visit the factory floor first"             │
└──────────────────────────────────────────────┘
```
- "ACTIVE SITE": Space Mono, lime, tiny
- Site name: Syne 800, 2.5rem, --text-primary
- Location: Space Grotesk, --text-secondary, with MapPin icon
- Appointment card: --surface-raised, border --border-bright, left border 3px --lime
- Date in Syne 700, --text-primary; notes in Space Grotesk, --text-secondary

**Phase Progress Bar (Segmented):**
Three blocks in a row (or stacked on mobile):
```css
/* Each segment */
.phase-segment {
  flex: 1;
  height: 52px;
  background: var(--surface);
  border: 1.5px solid var(--border);
  border-radius: 8px;
  overflow: hidden;
  position: relative;
  display: flex;
  align-items: center;
  padding: 0 16px;
}
.phase-fill {
  position: absolute;
  left: 0; top: 0; bottom: 0;
  background: linear-gradient(90deg, var(--lime), var(--mint));
  opacity: 0.2;
  transition: width 600ms ease-out;
}
/* active segment gets lime border */
.phase-segment.active { border-color: var(--lime); }
```
Text inside: "ASSESSMENT · 54%" in Space Mono 700, 11px, --text-primary

**Phase Tabs:** Three buttons below the segments — match the segments. Clicking a tab both shows that phase's content AND changes active border.

**Auto-Save Indicator (top right of form area):**
```
● Saving…          ← amber pulse dot
● Auto-saved 10:24 ← mint solid dot
○ Auto-save on     ← dim
```

**Phase Submitted Card:**
```
┌──────────────────────────────────────────┐
│                                          │
│   ⬡  ASSESSMENT SUBMITTED               │
│      Phase complete. Ready for next.     │
│                                          │
│      [Go to Installation →]              │
│                                          │
└──────────────────────────────────────────┘
```
Border: 1.5px --lime, bg: --lime-dim, icon in --lime

**Thank You — Full Screen:**
- bg: `radial-gradient(ellipse at center, #1a2a00 0%, #08080F 65%)`
- Centered:
  - Animated pulsing circle (3 rings: outer faint, middle lime/15, inner lime/30, center lime filled with ✓)
  - "THANK YOU" in Syne 800, 5rem, --lime
  - "All phases submitted." Syne 700, 1.5rem, --text-primary
  - "Your work on **Infosys Bengaluru** is complete. Your manager will review shortly." Space Grotesk, --text-secondary
  - [Sign Out →] lime button

---

### Assessment Phase — All Sections

Section cards: `bg: --surface, border: 1.5px --border, border-radius: 10px, border-left: 3px --lime`

The ghost section number sits absolute in top-right of each card.

#### "Complete the Job" Component (every section)

```tsx
// Full-width achievement-style row at bottom of each section
// Separated by top border from section content above

<div className={`complete-job-row ${checked ? 'complete' : ''}`}>
  <div className="complete-job-icon">
    {checked ? <CheckCircle2 size={20} /> : <Circle size={20} />}
  </div>
  <div className="complete-job-text">
    <span className="label">COMPLETE THE JOB</span>
    <span className="sub">{checked ? "Section marked done" : "Mark this section as done"}</span>
  </div>
  <div className="complete-job-toggle">
    {/* actual checkbox input hidden, click anywhere to toggle */}
  </div>
</div>
```

Unchecked styles: bg transparent, border 1.5px --border-bright, text --text-secondary
Checked styles: bg --lime-dim, border 1.5px --lime/40, icon --lime, text --lime

#### Section 1: Factory Call
- Complete the job row (`factory_call_done`)
- Status badge: DONE (mint) or PENDING (warning)
- If done: datetime input "Completed at" (`factory_call_at`)
- Custom fields for "Factory Call"

#### Section 2: Third Party Call
- Complete the job row (`third_party_call_done`)
- Status badge
- If done: datetime input (`third_party_call_at`)
- Custom fields for "Third Party Call"

#### Section 3: Book Appointment
- Client Company Name input
- Date + Time inputs (2-col grid)
- Meeting Mode segmented: In Person / Video Call / Phone
- Notes textarea
- "Save Appointment" → `appointment_saved: true` + updates `sites.appt_date/appt_time`
- "Edit Appointment" button when saved
- Complete the job row (`appointment_saved`)
- Custom fields for "Appointment"

#### Section 4: Facility Visit
- Complete the job row (`facility_visit_done`) — triggers `facility_visit_at` = now()
- If done: 2-col — "Visited at" datetime + "Visited by" (auto from profile name, read-only)
- Custom fields for "Facility Visit"

#### Section 5: Explanation
- Explanation Notes textarea (6 rows, required *)
- Character count in Space Mono tiny below
- "Save Explanation" / "Edit Explanation" button
- Complete the job row (`explanation_saved`)
- Custom fields for "Explanation"

#### Section 6: Contact Numbers
- Add/remove contacts list:
  - Each contact: "CONTACT 01" Space Mono label + delete button
  - Fields: Name*, Designation*, Mobile*, Email (optional)
  - 2-col grid on desktop
- "Add Another Contact" secondary button
- Complete the job row (`contacts_done`) — below contacts card

#### Section 7: Floor Visit with Machine Photos
- Complete the job row (`floor_visit_done`)
- MediaUploader (image/* only, section="floor-visit")
- Custom fields for "Floor Visit"

#### Section 8: Business Profile
- 2-col grid form:
  - Business Name*, Industry Type* (select: Manufacturing / Textile / Chemical / Food Processing / Other)
  - GST Number, Primary Contact Name*
  - Address* (col-span-2 on desktop)
  - City*, State*, PIN*, Primary Contact Number*
- "Save Business Profile" / "Edit Business Profile" button
- All inputs disabled when saved
- Complete the job row (`business_profile_saved`)
- Custom fields for "Business Profile"

#### Section 9: Machine Details
- List of machines, each in a bordered inner card:
  - "MACHINE 01" label + delete
  - Name, Make/Brand, Model Number, Serial Number, Year, Condition (Good/Average/Poor)
- "Add Machine" secondary button
- Complete the job row (`machines_done`) — below machines card

#### Section 10: MOM (Minutes of Meeting)
- MediaUploader (PDF/DOC, bucket="site-docs", section="mom")
- "Quick Notes" textarea (onBlur also sets `mom_uploaded: true`)
- Complete the job row (`mom_uploaded`)
- Custom fields for "MOM"

#### Section 11: Photos & Videos
- MediaUploader (any media, section="media")
- Complete the job row (`media_uploaded`)
- Custom fields for "Media"

**Assessment Submit Button:**
Full-width lime button: "SUBMIT ASSESSMENT PHASE →"
Validate: contacts (min 1, Name+Designation+Mobile required), explanation notes not empty, business profile required fields.

---

### Installation Phase — Sections

#### Section 1: Delivery Confirmation
- Status badge row
- Date of Delivery, Units Received (2-col)
- Condition: Good / Damaged / Partial segmented
- Delivery Agent Name
- Notes textarea
- "Confirm Delivery" / "Edit Delivery" button
- Complete the job row (`delivery_confirmed`)
- Custom fields for "Delivery"

#### Section 2: Installation Coordination
- Complete the job row (`coordination_done`) — triggers timestamp
- If done: "What was coordinated?" textarea
- Custom fields for "Coordination"

#### Section 3: Installation Photos
- MediaUploader (section="photos")
- Complete the job row (`photos_uploaded`)
- Custom fields for "Photos"

**Submit:** "SUBMIT INSTALLATION PHASE →"

---

### Commissioning Phase — Sections

Sections 1–5 rendered dynamically from array:

```ts
const steps = [
  { num: 1, key: "coordination_done", title: "Coordination" },
  { num: 2, key: "visit_done", title: "Visit", photo: true },
  { num: 3, key: "connection_done", title: "Connection", photo: true },
  { num: 4, key: "configure_done", title: "Configure Hardware & Software", photo: true,
    notesKey: "configure_notes", notesLabel: "Configuration details (firmware version, parameters)" },
  { num: 5, key: "testing_done", title: "Testing", photo: true,
    notesKey: "testing_notes", notesLabel: "Test results" },
]
```
Each: Complete the job row + optional notes textarea + optional photo uploader

#### Section 6: Screenshots & Photos
- MediaUploader (section="screenshots")
- Complete the job row (`screenshots_uploaded`)

#### Section 7: Completion Certificate
- Complete the job row (`certificate_sent`) + auto-timestamp
- Date picker input
- Photo/PDF uploader (section="certificate")
- Mint badge when certificate_sent_at exists

#### Section 8: Final MOM
- PDF/DOC uploader (bucket="site-docs", section="final-mom")
- Notes textarea
- "Submit Final MOM" / "Edit Final MOM" button
- Complete the job row (`final_mom_uploaded`)

**Submit:** "SUBMIT COMMISSIONING PHASE →" → triggers Thank You screen

---

### Manager / Owner Shell

**Desktop Sidebar (260px, bg --bg, border-right 1.5px --border):**
```
┌──────────────────────┐
│ ⬡ SIM-KIT OPS        │
│ MANAGER              │
├──────────────────────┤
│ ● Overview           │ ← active: left 3px --lime, text --lime, bg rgba(lime,0.05)
│ ○ Sites              │ ← inactive: text --text-secondary
│ ○ Business Consult…  │
│ ○ Performance        │
│ ○ Reports            │
│ ○ Managers  [owner]  │
│ ○ Settings  [owner]  │
├──────────────────────┤
│ Tirthh Thakar        │
│ [→ Sign Out]         │
└──────────────────────┘
```

Logo mark: small geometric hexagon SVG in --lime
"SIM-KIT OPS": Syne 700, --text-primary
Role chip: Space Mono, --text-dim, uppercase

**Mobile:** Top bar (bg --bg, border-bottom) + hamburger opens full-screen dark slide-down drawer (same nav items, animated)

---

### `/manager` — Overview Dashboard

**Page header:** "OVERVIEW" Space Mono chip + "Dashboard" Syne 700 h1 + date in Space Mono --text-dim

**Stats Grid (4 cards, 2x2 on mobile, 4-col on desktop):**

```
┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌──────────────┐
│  24          │ │  8           │ │  47          │ │  11          │
│  TOTAL SITES │ │  ACTIVE CON. │ │  PHASES DONE │ │  IN PROGRESS │
│  ↑ 3 week   │ │              │ │              │ │              │
└──────────────┘ └──────────────┘ └──────────────┘ └──────────────┘
```

Numbers: Space Mono 700, 3rem, --text-primary
Labels: Space Mono, 0.6rem, uppercase, --text-dim
Trend: tiny badge (↑ lime / ↓ coral)

**Pipeline Section:**

Heading: "PIPELINE" mono chip + "Site Funnel" Syne 700

```
UNASSIGNED   ████████████████████████████████████████ 24
SCHEDULED    ██████████████████████████████████ 18
ASSESSMENT   ████████████████████████████ 14
INSTALLATION ████████████████████████ 11
COMMISSIONING ████████████████ 7
DONE         ████████ 4
```

Each bar: `height: 10px, border-radius: 2px`
Color fills: lime at descending opacity (100% → 15%)
Labels: Space Mono, left-aligned; counts Space Mono right-aligned
Row height: 40px total with labels

**Upcoming Appointments (next 7 days):**
Table or card list:
- Site name (Syne 600), city (Space Grotesk, --text-secondary), consultant name, "MON 20 JAN · 10:00" in Space Mono
- If none: EmptyState with Calendar icon

**Stuck Sites (30+ days no update):**
- Site name, "X days stalled" in coral badge, consultant name
- If none: EmptyState

---

### `/manager/sites` — Sites

**Header row:** "SITES" chip + "Sites" h1 + "New Site +" lime button

**Create/Edit Site — Slide-over Panel (right drawer, 480px):**
- Site Name (required)
- City (dropdown from settings.default_cities + manual)
- State, Address textarea
- Auto-assign Consultant dropdown (optional)
- "Create Site" lime button

**Sites Grid/List (toggle view):**

Card layout:
```
┌─────────────────────────────────────┐
│ INFOSYS BENGALURU                   │
│ Bengaluru, Karnataka                │
│                                     │
│ [RAJESH KUMAR]  [TASK SET]          │
│                                     │
│ Assessment  ████████░░  80%         │
│ Installation ████░░░░░░  40%        │
│ Commissioning ░░░░░░░░░░  0%        │
│                                     │
│            [Edit]  [Delete ⚠]       │
└─────────────────────────────────────┘
```

Phase bars: 4px height, lime/mint gradient for fill
Delete: opens AlertDialog confirm (Radix) — "This will permanently delete all data for this site."

---

### `/manager/tasks` — Task Assignment

**List of all sites, each as a collapsible card:**

Collapsed header:
- Site name (Syne 600), city, [TASK SET] or [NO TASK] badge, Edit / Assign Task button

Expanded edit form:
- Business Consultant (select)
- Date (date input)
- Time (time input)
- Active Phase (select: Assessment Visit / Installation / Commissioning)
- Notes (textarea, optional)
- "Save Task" lime | "Clear Task" danger ghost | "Cancel" ghost

Summary (when task set, not editing):
- Consultant name, Date, Time, Assigned timestamp, Phase badge, Notes text

---

### `/manager/business-consultants` — Consultant Management

**Header + active/inactive pill tabs**

**Consultant Card:**
```
┌──────────────────────────────────────────────────┐
│ ┌───┐                                            │
│ │ RK│  RAJESH KUMAR           [ACTIVE]           │
│ └───┘  +91 98765 43210                           │
│        rajesh@email.com                          │
│                                                  │
│  [Deactivate]          [Clear Consultant Side ⚠] │
└──────────────────────────────────────────────────┘
```

Avatar: 48x48, bg --surface-raised, Space Mono 700 initials, --lime border
"Clear Consultant Side" → AlertDialog: "This removes all their tasks, phase data, contacts, machines, and media. Cannot be undone."
On confirm → clear all sites assignments for this worker + delete assessment/installation/commissioning/contacts/machines/media rows

---

### `/manager/performance` — Performance

**Three-level accordion: Consultant → Site → Phase Detail**

**Level 1 — Consultant Row:**
```
▶ RAJESH KUMAR ─── 3 sites ─── avg 58%     [expand]
```
Syne 600 name, Space Mono counts, lime chevron, click to expand

**Level 2 — Site (inside consultant):**
```
  INFOSYS BENGALURU · Bengaluru
  Assessment   [████████░░] 80%
  Installation [████░░░░░░] 40%
  Commissioning [░░░░░░░░░░]  0%
  [View Details ↓]
```

Completion bars: 6px, lime-to-mint gradient, --border track
Completion % formula uses ONLY the specific boolean keys (NOT all JSON fields):
- Assessment: 11 keys listed above
- Installation: 3 keys
- Commissioning: 8 keys

**Level 3 — Phase Detail:**

Shown on "View Details" click. Scrollable card:

Assessment:
- Factory Call: [DONE] + timestamp or [PENDING]
- Third Party Call: same
- Appointment: date, time, mode, company
- Facility Visit: done + who
- Explanation Notes: text preview
- Contacts: count chip + list (name, designation, mobile)
- Floor Visit: done badge
- Business Profile: city, industry, GST, etc.
- Machines: count chip + list
- MOM: notes text
- Media: uploaded badge

Installation: delivery info, coordination notes, photos status

Commissioning: each step timestamp, configure/testing notes, cert date, final MOM

---

### `/manager/reports` — Reports

**Filter Bar (horizontal on desktop, stacked on mobile):**
- Date Range: from / to date inputs
- City: multi-select dropdown
- Consultant: select
- Phase: All / Assessment / Installation / Commissioning
- [Apply] lime button + [Reset] ghost link

**Results Count:** "Showing 14 sites" in Space Mono

**Table:**
Columns: Site | City | Consultant | Assessment % | Installation % | Commissioning % | Assigned | Created
- Striped rows: odd rows slightly darker
- % cells: show colored bar inside cell (inline mini bar)
- Dates: Space Mono, --text-secondary

**"Export CSV" button** (top right, secondary): downloads `simkit-report-YYYY-MM-DD.csv`

---

### `/owner/managers` — Manager Management

**"MANAGERS" chip + "Managers" h1 + "Add Manager +" lime button**

**Add Manager Modal:**
- Email input — looks up user in profiles, promotes to supervisor
- Error if not found or already manager

**Pending Approval section:**
- Amber "PENDING" badge
- Each: name, email, "Approve" lime button

**Active Managers grid:**
- Same card style as consultants
- "Deactivate" / "Demote to Worker ⚠" buttons
- Demote: AlertDialog confirm

---

### `/owner/forms` — Forms & Tasks Builder

**"FORMS & TASKS" chip + h1**

**Two-tab switcher:** Task Assignment | Custom Fields

**Task Assignment tab:** Identical to `/manager/tasks`

**Custom Fields tab:**

Phase selector: three pill buttons (Assessment / Installation / Commissioning)

Add Field form (card):
- Section dropdown (varies by phase):
  - Assessment: Factory Call, Third Party Call, Appointment, Facility Visit, Explanation, Contacts, Floor Visit, Business Profile, Machines, MOM, Media
  - Installation: Delivery, Coordination, Photos
  - Commissioning: Coordination, Visit, Connection, Configure, Testing, Screenshots, Certificate, Final MOM
- Label input
- Field Type select: Text / Number / Textarea / Dropdown / Checkbox / File Upload
- If Dropdown: comma-separated options input
- Assign to: All Consultants OR specific consultant select
- "Add Field +" lime button

Existing fields list:
- Each row: label, [TYPE] chip in Space Mono, [SECTION] chip, "For: All / Name"
- Trash button → immediate delete
- Grouped by phase, filtered by phase tab

---

### `/owner/settings` — Settings

**"SETTINGS" chip + "Settings" h1**

Two settings cards:

**Company Name:**
- Label + input
- Auto-saves on blur with mint success indicator

**Default Cities:**
- Label + textarea (comma-separated)
- "These appear in the City dropdown when creating sites"
- Auto-saves on blur

---

## CUSTOM HOOKS & UTILITIES

### `usePhaseData<T>` Hook

```ts
function usePhaseData<T extends Record<string, any>>(
  phase: "assessment" | "installation" | "commissioning",
  siteId: string,
  workerId: string,
  defaultData: T
): {
  data: T
  patch: (partial: Partial<T>) => void  // debounced auto-save 800ms
  save: (fullData?: T) => void           // immediate save
  loaded: boolean
  saving: boolean
  lastSaved: Date | null
}
```

On mount: `SELECT data FROM {phase} WHERE site_id = siteId`
`patch()`: merge → debounce 800ms → upsert
`save()`: immediate upsert, updates lastSaved

### `parseTaskNotes`

```ts
// "[PHASE:assessment]Visit the factory" → { phase: "assessment", cleanNotes: "Visit the factory" }
// Strips [SECTION:*] and [HIDDEN:*] legacy tags
```

### `MediaUploader` Component

Props: `siteId, phase, section, accept?, bucket? (default: "site-media"), disabled?`

- Dashed border upload zone with upload icon
- On drop/select → Supabase Storage upload to `{siteId}/{phase}/{section}/{filename}`
- Insert record to `media` table
- Show uploaded files list: filename, size, delete button
- Multiple files supported
- Disabled: read-only display

---

## KEY BUSINESS RULES

1. Workers only see their assigned site (`sites.assigned_worker_id = userId`)
2. All 3 phase tabs always visible — never hidden
3. After phase submit → `PhaseSubmittedCard` in place (tracked in React state `Set<string>`)
4. After Commissioning submit → full-screen Thank You, then sign out
5. Auto-save is silent (no success toast, just indicator dot)
6. Completion % uses ONLY the specific boolean keys — not all JSON fields
7. Custom fields render at bottom of their section in consultant forms
8. Task notes stored as `[PHASE:assessment]text` — strip before display
9. `is_active: false` → show "Awaiting Approval" screen, no features accessible
10. Contacts: Name + Designation + Mobile required; Email optional
11. Real-time subscription on `sites` table for consultant page

---

## ANIMATIONS & MICRO-INTERACTIONS

```css
/* Page enter */
@keyframes page-enter {
  from { opacity: 0; transform: translateY(10px); }
  to   { opacity: 1; transform: translateY(0); }
}
.page-enter { animation: page-enter 200ms ease-out; }

/* Accordion open */
[data-state=open] .accordion-content {
  animation: accordion-down 200ms ease-out;
}

/* Progress bar fill */
.progress-fill { transition: width 600ms cubic-bezier(0.4, 0, 0.2, 1); }

/* Complete-the-job row toggle */
.complete-job-row { transition: background 150ms, border-color 150ms; }

/* Save dot pulse */
@keyframes pulse-amber { 0%,100% { opacity:1; } 50% { opacity:0.3; } }
.dot-saving { animation: pulse-amber 1.2s infinite; }

/* Thank You pulsing rings */
@keyframes ring-pulse {
  0%   { transform: scale(1);   opacity: 0.6; }
  100% { transform: scale(2.5); opacity: 0;   }
}
.ring-1 { animation: ring-pulse 2s infinite; }
.ring-2 { animation: ring-pulse 2s 0.5s infinite; }
.ring-3 { animation: ring-pulse 2s 1s infinite; }

/* Button press */
button:active { transform: scale(0.97); }

/* Hover on cards */
.site-card { transition: border-color 150ms; }
.site-card:hover { border-color: var(--border-bright); }
```

---

## FOLDER STRUCTURE

```
app/
├── (auth)/auth/page.tsx
├── business-consultant/page.tsx
├── manager/
│   ├── layout.tsx
│   ├── page.tsx
│   ├── sites/page.tsx
│   ├── tasks/page.tsx
│   ├── business-consultants/page.tsx
│   ├── performance/page.tsx
│   └── reports/page.tsx
└── owner/
    ├── layout.tsx
    ├── page.tsx
    ├── sites/page.tsx, tasks/page.tsx
    ├── business-consultants/page.tsx
    ├── performance/page.tsx, reports/page.tsx
    ├── managers/page.tsx
    ├── forms/page.tsx
    └── settings/page.tsx

components/
├── ui/              (Radix-based primitives, dark-themed)
├── ui-kit.tsx       (Card, SectionTitle, Badge, Segmented, EmptyState, ProgressBar)
├── CompleteJobRow.tsx
├── MediaUploader.tsx
├── PhaseSegmentBar.tsx
├── staff/
│   ├── StaffShell.tsx
│   ├── Overview.tsx
│   ├── SitesPanel.tsx
│   ├── TasksPanel.tsx
│   ├── BusinessConsultantsPanel.tsx
│   ├── PerformancePanel.tsx
│   ├── ReportsPanel.tsx
│   └── FormsBuilder.tsx
└── business-consultant/
    ├── AssessmentTab.tsx
    ├── InstallationTab.tsx
    └── CommissioningTab.tsx

lib/
├── auth-store.ts
├── use-phase-data.ts
├── supabase.ts
├── parse-task-notes.ts
└── utils.ts
```

---

## FINAL DESIGN REMINDERS FOR STITCH

- **Dark mode ONLY** — no light mode. Background is `#08080F`, not white or gray.
- **Lime is the hero color** (`#C8FF4A`) — use it for CTAs, active states, highlights, and the "Complete the job" done state. It should pop against the dark background.
- **Syne font for ALL headings** — this is the personality of the app. Big, wide, bold.
- **Space Mono for ALL labels, chips, numbers, and data** — monospace creates a "field ops terminal" feel.
- **NO generic blue** — violet is used sparingly for secondary actions only.
- **Flat design** — no drop shadows on cards. Only borders create depth.
- **Every section card** has the 3px left lime border and the ghost section number.
- **"Complete the job" is NOT a boring checkbox** — it's the achievement-style full-width row component.
- **Phase segments** at top of consultant view are 52px tall blocks, not a thin progress bar.
- **Stat numbers** are 3.5rem Space Mono — they should DOMINATE the card.
- **Pipeline bars** are hand-crafted horizontal bars, NOT a charting library's default.
- **Toasts** are dark-styled with colored left border (not default white sonner style).
- Apply `overflow-x: hidden` to body — no horizontal scroll on any breakpoint.
- Consultant page max-width: 768px centered. Manager pages max-width: 1440px.

---

*3 user roles · 13 pages · 22 form sections across 3 phases · real-time sync · auto-save · custom fields · media uploads · CSV reports · manager approval workflow · performance analytics*

**Design philosophy: Dark. Electric. Intentional. Not another dashboard.**
