# Top Notch Dog Grooming — online booking

Pet owners sign in, add their pets once, and book grooming appointments from a calendar that shows how busy each day is. The groomer runs the day from a phone or tablet: check-in, start, done, report cards, time off, prices and reports.

**Stack:** Vue 3 + TypeScript (Vite, Pinia, Vue Router) · Azure Static Web Apps (Standard) with managed **Node.js 22 Azure Functions** in `/api` · **Azure Cosmos DB** (NoSQL, serverless) · Entra External ID sign-in · Azure Communication Services email · Application Insights · Bicep · GitHub Actions.

Settled scope: one groomer, no online payments, email notifications, and phone-first UI everywhere.

**Brand:** the Top Notch logo (`public/brand/logo.png` and `logo@2x.png`) and its palette run through the whole app: logo yellow `#FAD006`, black and white. Swap in a higher-resolution logo by replacing those two files, keeping the names, and the header, home page, emails and app icons all pick it up. The icons are regenerated from it.

**Services and prices (Philippine pesos):** the shop's price list is built in and shown as a services menu on the home page and at `/services`. Dog prices go by the **dog size** owners pick when they add a dog; cats are one price. Ranges depend on coat volume, and the groomer enters the final amount at check-out.

| Service | Small | Medium | Large (e.g. Golden Retriever) | Husky, Chow Chow & similar |
|---|---|---|---|---|
| Basic Grooming | ₱380 shaved / summer cut, ₱430 with face design | ₱480, ₱530 with face design | ₱650 | ₱750–₱850 |
| Full Grooming | ₱500 | ₱600 | ₱700 | ₱800–₱850 |
| Cat Grooming | ₱500 for every cat | | | |
| Bath / Blow Dry | ₱250 | ₱350 | ₱450–₱550 | ₱450–₱550 |

Basic Grooming includes bath and blow dry, nail cut, ear cleaning, sanitary cleaning, paw pad trimming, toothbrush and anal drain; Full Grooming adds a full haircut with design; Cat Grooming covers bath and blow dry, nail cut, ear cleaning, sanitary cleaning and paw pad trimming. The face design is an option on Basic Grooming for small and medium dogs. Times are starting values. Change any of it under Shop settings → Services and Extras. The shop time zone defaults to `Asia/Manila`.

---

## Features

### For pet owners
- **Tile calendar of open times.** Each day is a tile whose yellow fill rises as it books up. It shows the count of open starts, swipes between months, has full keyboard and screen-reader support, and a **Next opening** button.
- **4-step booking** (pet, service, time, confirm) with each service's inclusions, price and duration for the pet's size (and the face-design option where it applies), pick-up time, notes for the groomer, and a sticky thumb-zone action bar.
- **Repeat visits:** book every N weeks for several visits in one go. Dates that are taken are skipped and listed.
- **Waitlist** for full days, by any time, morning or afternoon. When someone cancels, everyone waiting gets an email straight away.
- **Change time or cancel** without calling. Late changes inside the policy window are flagged, not blocked.
- **Pet profiles:** camera photo (resized on the phone before upload), breed, a required **Dog size** dropdown (cats have no size), weight in kg, temperament, allergies, medical and behaviour notes, grooming preferences, vet, and vaccination dates with expiry warnings. Booking is blocked if rabies is missing or expires first (configurable).
- **Dashboard:** next visit with countdown, **Add to calendar** (`.ics` served as `text/calendar` so iOS and Android open it natively), Google Calendar link, directions, share sheet, one-tap **Book again**, and the groomer's suggested next date.
- **Report cards and reviews** after each visit (1–5 stars plus comment).
- **Emails:** confirmation with calendar attachment, change, cancellation (with `METHOD:CANCEL` .ics), 24-hour reminder (opt-out), waitlist opening, and report card ready.
- **Client details:** full name, contact number, email and address are collected on first sign-in and editable under Account, along with reminder preferences, emergency contact, download my data (JSON), delete account.
- **Installable PWA:** home-screen icon, works offline for viewing saved visits, offers a one-tap update, follows dark mode, respects reduced motion.

### For the groomer (staff portal, `admin` role)
- **Today:** agenda with pet alerts (allergies, nervous or reactive), owner notes, tap-to-call, one-tap **Check in → Start groom → Mark done**, no-show, free gaps for walk-ins, auto-refresh, swipe between days.
- **Week board:** time grid with breaks, closures and status colours. On phones it starts at today.
- **Appointment detail:** amount actually charged, private staff notes, report card (emails the owner), move, cancel with a reason (emails the owner), and "text ready for pick-up".
- **Clients:** search by owner, phone or pet name; contact number, email and address; full pet profiles; history; lifetime spend; no-show count and reset; **Book for client** for phone and walk-in bookings, which bypasses notice and horizon rules but never overlaps.
- **Shop settings:** services (what's included, plus duration, price, optional "up to" price and a note for each dog size), extras that can be tied to one service and certain sizes (the face design to start), weekly hours with breaks, booking rules (start-time step, clean-up buffer, minimum notice, horizon, cancellation window, daily cap, per-client cap, no-show pause, vaccination requirement), shop details, policy text, and time off (full or partial days).
- **Reports:** revenue, average ticket, no-show rate, late cancellations, new clients, rating, visits by weekday and hour, top services, and **CSV export** (formula-injection safe).

---

## Architecture

```mermaid
flowchart LR
  subgraph Browser["Phone / tablet / desktop (PWA)"]
    UI[Vue 3 + TS]
  end
  subgraph SWA["Azure Static Web Apps (Standard)"]
    CDN[Static assets + SPA fallback]
    AUTH["/.auth (custom OIDC)"]
    API["Managed Functions /api (Node 22)"]
  end
  UI --> CDN
  UI --> AUTH
  UI -->|"/api/* (x-ms-client-principal)"| API
  AUTH <-->|OIDC| EID[Entra External ID]
  AUTH -->|rolesSource /api/roles| API
  API --> COSMOS[(Cosmos DB serverless)]
  API --> ACS[ACS Email]
  API --> AI[Application Insights]
  GH[GitHub Actions hourly] -->|POST /api/jobs/reminders + x-jobs-key| API
```

- **Auth:** SWA custom OpenID Connect provider `entraExternalId`. At sign-in SWA calls `/api/roles` (the `rolesSource` function), which grants `admin` to anyone listed in `ADMIN_EMAILS`. Route rules in `staticwebapp.config.json` gate `/api/*` and `/api/staff/*`, and every handler re-checks the principal.
- **Reminders:** managed functions only support HTTP triggers, so `.github/workflows/reminders.yml` calls a key-protected endpoint hourly. It's idempotent because each appointment is stamped `reminderSentAt`.

### Why double booking can't happen

The day is cut into 15-minute blocks. Every appointment owns one **lock document** per block it covers (service time plus clean-up buffer, e.g. `lock-09:15`). The `bookings` container is partitioned by **day**, so the appointment, its locks and a per-day counter are written in **one Cosmos transactional batch**. If any lock already exists, Cosmos returns `409` and the whole batch rolls back. Two people tapping the same time at the same moment get one booking and one "someone just booked that time".

- The per-day counter uses an ETag (`If-Match`) to enforce the daily cap atomically.
- Cancel and reschedule release locks in the same transaction, with ETag checks against stale edits.
- Locks always use the 15-minute grid, even if you change start times to every 30 or 60 minutes, so they never misalign.
- Lock, summary and waitlist documents carry a Cosmos **TTL** and expire about a week after their day. Appointments are kept.

`api/test/booking.test.ts` races two overlapping bookings against an in-memory container with the same batch semantics. `api/test/availability.test.ts` covers hours, breaks, closures, buffers, notice, horizon, daily caps and a DST change.

### Data model (database `grooming`)

| Container | Partition key | Holds |
|---|---|---|
| `owners` | `/ownerId` | the owner's profile + their pets (one partition = "my account") |
| `bookings` | `/day` | appointments, slot locks, a daily `summary`, waitlist entries |
| `catalog` | `/kind` | `settings`, services, add-ons, closures |

Settings and the service menu are seeded on first run. A database seeded before the peso price list gets it once on the next cold start: untouched original services are replaced, edited ones keep their prices and just gain their "what's included" list.

---

## Project layout

```
├─ src/                      Vue app
│  ├─ components/            TileCalendar, SlotPicker, PetForm, AgendaCard, BarChart, SheetDialog…
│  ├─ views/                 owner screens; views/admin/ = staff portal
│  ├─ stores/                Pinia: session, catalog, account, ui
│  ├─ composables/           useAvailability (cached + prefetch), useSwipe, useStaffActions
│  └─ api/client.ts          typed API client
├─ api/                      Azure Functions (v4 programming model, TypeScript)
│  ├─ src/functions/         public, me, pets, appointments, waitlist, admin, roles, jobs
│  ├─ src/lib/               availability engine, transactional booking, Cosmos, email, auth, validation (zod)
│  ├─ src/shared/            types + helpers shared with the front end (single source of truth)
│  └─ test/                  vitest
├─ infra/main.bicep          SWA, Cosmos, ACS Email, App Insights (+ main.bicepparam)
├─ tools/demo-server.mjs     click-through demo with an in-memory API (no Azure needed)
├─ staticwebapp.config.json  routes, roles, custom auth, CSP and security headers
├─ .github/workflows/        CI/CD with PR preview environments, hourly reminders
├─ .vscode/extensions.json   recommended VS Code extensions (incl. Claude Code)
├─ CLAUDE.md                 project briefing Claude Code reads at the start of every session
└─ .claude/settings.json     Claude Code guardrails: no reading secrets, ask before az / git push
```

---

## Try it in two minutes (no Azure)

```bash
npm install && npm --prefix api install
npm run build && npm --prefix api run build
npm run demo
```

Open `http://localhost:4280/?as=owner` for the owner app, `?as=admin` for the staff portal, or `?as=guest` for a visitor. The demo uses the real availability engine with sample data held in memory.

## Run the full stack locally

Prerequisites: Node 22, [Azure Functions Core Tools v4](https://learn.microsoft.com/azure/azure-functions/functions-run-local), [SWA CLI](https://azure.github.io/static-web-apps-cli/) (`npm i -g @azure/static-web-apps-cli`), and the [Cosmos DB emulator](https://learn.microsoft.com/azure/cosmos-db/emulator) (or a real serverless account).

```bash
cp api/local.settings.sample.json api/local.settings.json   # set ADMIN_EMAILS etc.
npm --prefix api start      # Functions on :7071 (builds first)
npm run dev                 # Vite on :5173
swa start                   # everything on http://localhost:4280 via swa-cli.config.json
```

The SWA CLI shows a mock sign-in form. Type `admin` in the roles box to see the staff portal. The real `rolesSource` call only happens in Azure. Leave `ACS_CONNECTION_STRING` empty locally and emails are logged instead of sent.

---

## Deploy to Azure

### 1. Provision infrastructure

```bash
az login
az group create -n rg-topnotch -l centralus
export ADMIN_EMAILS="groomer@yourshop.com"
export JOBS_KEY="$(openssl rand -hex 24)"     # keep this; GitHub needs it too
az deployment group create -g rg-topnotch -f infra/main.bicep -p infra/main.bicepparam
```

Outputs include the site hostname and the exact **Entra redirect URI**.

### 2. Set up Entra External ID (customer sign-in)

1. In the Microsoft Entra admin center, create an **external tenant** for your customers.
2. **App registrations → New registration.** Choose single tenant, platform **Web**, and set the redirect URI to `https://<your-site>/.auth/login/entraExternalId/callback`. Use the deployment output for this.
3. **Authentication:** tick **ID tokens**. **Certificates & secrets:** create a client secret.
4. **Token configuration → Add optional claim → ID → `email`.** SWA uses it as the user's name and the roles function matches it against `ADMIN_EMAILS`.
5. **User flows → New "Sign up and sign in"** with email + password (or email one-time passcode). Collect *Display name*. Open the flow and choose **Applications → Add application**, then select your app. Optionally add Google or Facebook under External Identities.
6. Note the metadata URL: `https://<tenant-subdomain>.ciamlogin.com/<tenant-id>/v2.0/.well-known/openid-configuration`.
7. Give SWA the credentials:
   ```bash
   az staticwebapp appsettings set -n <swa-name> --setting-names \
     ENTRA_EXTERNAL_ID_CLIENT_ID=<app-id> ENTRA_EXTERNAL_ID_CLIENT_SECRET=<secret>
   ```

### 3. Configure GitHub and deploy

| Kind | Name | Value |
|---|---|---|
| Secret | `AZURE_STATIC_WEB_APPS_API_TOKEN` | `az staticwebapp secrets list -n <swa-name> --query properties.apiKey -o tsv` |
| Secret | `JOBS_KEY` | same value as in step 1 |
| Variable | `ENTRA_WELL_KNOWN_URL` | metadata URL from step 2.6 (injected into `staticwebapp.config.json` at deploy) |
| Variable | `SWA_HOSTNAME` | e.g. `nice-sea-0123.azurestaticapps.net` or your custom domain |

Push to `main`. The workflow type-checks both projects, runs the booking-engine tests, builds and deploys. Pull requests get their own preview URL; add that preview's redirect URI to the app registration if you want to sign in there. Sign in with an `ADMIN_EMAILS` address and tap **Staff**.

### 4. Optional polish
- **Custom domain:** add it in SWA, then add `https://<domain>/.auth/login/entraExternalId/callback` to the app registration and update `APP_BASE_URL`.
- **Custom email domain:** connect a verified domain to the ACS Email service for your own sender address and better deliverability.
- **Staff copy of bookings:** set `STAFF_NOTIFY_EMAIL`.

---

## Configuration (SWA application settings)

| Setting | Purpose |
|---|---|
| `COSMOS_ENDPOINT` / `COSMOS_KEY` (or `COSMOS_CONNECTION_STRING`) | Cosmos DB access. Managed functions can't use managed identity. |
| `COSMOS_DATABASE` | default `grooming` |
| `COSMOS_SKIP_INIT` | `true` skips create-if-not-exists and seeding on cold start |
| `ADMIN_EMAILS` | comma-separated staff emails → `admin` role (applies on next sign-in) |
| `ENTRA_EXTERNAL_ID_CLIENT_ID` / `_SECRET` | custom OIDC provider credentials |
| `ACS_CONNECTION_STRING` / `EMAIL_SENDER` | email. Leave empty to log instead of send. |
| `STAFF_NOTIFY_EMAIL` | optional copy of online bookings, moves and cancellations |
| `JOBS_KEY` | secret for `/api/jobs/reminders` (24+ chars) |
| `REMINDER_LEAD_HOURS` | default `24` |
| `APP_BASE_URL` | absolute links in emails |
| `SHOP_TIME_ZONE` | time zone used when seeding settings (default `Asia/Manila`) |
| `APPLICATIONINSIGHTS_CONNECTION_STRING` | telemetry for the managed functions |

Everything else (hours, rules, prices, policies) is edited in the staff portal.

## API reference

| Method & route | Who | What |
|---|---|---|
| `GET /api/public/catalog` | anyone | shop settings, services, extras, upcoming closures, rating |
| `GET /api/public/availability?from&to&serviceId&size&addOns[&exclude][&staff=1]` | anyone* | per-day status, open starts, capacity, next opening |
| `GET/PUT/DELETE /api/me`, `GET /api/me/export` | owner | profile, delete account, data export |
| `GET/POST /api/pets`, `GET/PUT/DELETE /api/pets/{id}` | owner | pet profiles (delete = archive) |
| `GET/POST /api/appointments` | owner (staff with `ownerId`) | list, book (incl. repeat series) |
| `GET /api/appointments/{id}` · `/ics` | owner/staff | details, calendar file |
| `POST /api/appointments/{id}/cancel` · `/reschedule` · `/review`, `PUT …/notes` | owner | manage a booking |
| `GET/POST /api/waitlist`, `DELETE /api/waitlist/{day}/{id}` | owner | waitlist |
| `GET /api/staff/agenda?from&to` | staff | appointments, waitlist and closures for a range |
| `GET /api/staff/appointments/{id}`, `POST …/status` · `…/reschedule`, `PUT …/staff-notes` · `…/report-card` | staff | run the day |
| `GET/PUT /api/staff/settings` | staff | hours and rules |
| `GET/POST /api/staff/catalog/{service\|addon\|closure}`, `PUT/DELETE …/{id}` | staff | menu and time off |
| `GET /api/staff/clients?q`, `GET/PATCH /api/staff/clients/{ownerId}` | staff | client lookup, no-show reset |
| `GET /api/staff/stats?from&to`, `GET /api/staff/export?from&to` | staff | reports, CSV |
| `POST /api/roles` | SWA | rolesSource |
| `POST /api/jobs/reminders` | GitHub Actions (`x-jobs-key`) | send due reminders |
| `GET /api/health` | anyone | liveness + Cosmos check |

\* `exclude` requires the owner of that appointment or staff; `staff=1` requires staff.

## Security notes
- Authorization lives in two layers: SWA route rules, then handler checks (`requireUser` / `requireAdmin`, plus ownership checks on every record).
- All input is validated with zod. Pet photos are size-limited data URLs. Times must sit on the 15-minute grid.
- Strict CSP, HSTS, `nosniff`, and `frame-ancestors 'none'`. No third-party scripts or fonts; the Recursive font is self-hosted.
- Cached personal API responses are cleared from the service worker on sign-out, so shared tablets are safe.
- The CSV export neutralises spreadsheet formulas. The jobs endpoint uses a constant-time key compare.

## Design decisions worth knowing
- **Reminders through GitHub Actions** keep everything inside managed functions. GitHub may delay scheduled runs, and in **public** repositories it pauses them after 60 days without activity. Alternatives: a Logic App recurrence calling the same endpoint, or "bring your own" Functions with a timer trigger, which also enables managed identity for Cosmos.
- **Key auth to Cosmos** is required by managed functions. The key lives only in SWA app settings, written by Bicep with `listKeys()`.
- **Cross-day reschedules** book the new day first and then release the old one, so a failure can never leave the owner with no booking. Reads prefer the newest copy.

## Ideas for later
Online deposits (Stripe), SMS through ACS, multiple groomers or tables (add a `resourceId` to locks), loyalty punch card, before-and-after photo gallery (Blob Storage), syncing the groomer's agenda to Outlook or Teams, and a seasonal promotions banner.
