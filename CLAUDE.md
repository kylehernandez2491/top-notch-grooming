# Top Notch Dog Grooming — booking app

Online booking for a single-groomer shop. Pet owners sign in, register pets and book grooming slots from a
calendar; the groomer runs the day from a staff portal. Read `README.md` for features, architecture and the API.

## Stack
- Front end: Vue 3 + TypeScript, Pinia, vue-router, Vite, PWA (`src/`).
- API: Azure Functions v4, Node 22, TypeScript (`api/`), managed by Azure Static Web Apps (Standard plan).
- Data: Cosmos DB for NoSQL, serverless, database `grooming` (containers `owners`, `bookings`, `catalog`).
- Sign-in: Microsoft Entra External ID as SWA custom OIDC provider `entraExternalId`; `/api/roles` grants `admin`
  to emails in `ADMIN_EMAILS`.
- Email: Azure Communication Services. Reminders: `.github/workflows/reminders.yml` calls `/api/jobs/reminders` hourly.
- Infra: `infra/main.bicep` + `infra/main.bicepparam`. CI/CD: `.github/workflows/azure-static-web-apps.yml`.

## Commands (run from the project root)
```bash
npm install && npm --prefix api install   # dependencies
npm run typecheck                         # front-end types (vue-tsc)
npm run build                             # front-end build
npm --prefix api run typecheck            # API types
npm --prefix api test                     # vitest: 25 tests, all must pass
npm --prefix api run build && npm run demo  # after npm run build: http://localhost:4280/?as=owner (or ?as=admin)
```
Run all four checks before saying a change is done; CI runs the same ones and blocks the deploy if one fails.

## Rules for changes
- Types and helpers shared by the API and the front end live in `api/src/shared/` (imported as `@shared/...`).
  Change them there, never duplicate them in `src/`.
- Bookings must go through `api/src/lib/booking.ts`. It writes the appointment, one lock document per 15-minute
  block (`lock-HH:mm`) and the day's `summary` in one Cosmos transactional batch; that is what prevents double
  booking. Never write appointments or locks directly. Availability rules live in `api/src/lib/availability.ts`.
- Validate all API input with zod in `api/src/lib/validation.ts`.
- Services are only Basic Grooming, Full Grooming, Cat Grooming and Bath / Blow Dry, priced in Philippine pesos
  (`formatMoney` in `api/src/shared/format.ts`). Dog sizes are `small`, `medium`, `large`, `husky_chow`, shown to
  owners as "Dog size"; cats have one flat price and are always stored as `small`. Price ranges use
  `priceMaxBySize`; the face design is an add-on scoped to Basic Grooming for small and medium dogs.
- Client profiles require full name, contact number, email and address (`profileInput` in validation.ts).
- The shop time zone defaults to `Asia/Manila`; weights are in kg.
- Live hours, prices and services are in Cosmos and edited in the staff portal (Shop screen).
  `api/src/lib/seed.ts` seeds an empty database. Editing it only reaches a running site if you also bump
  `MENU_VERSION`, which makes `upgradeMenu` in `api/src/lib/cosmos.ts` apply it once to untouched services.
- Brand: black, white and yellow (`--brand #fad006`) tokens in `src/styles/main.css`; use tokens, not raw colours.
  Every screen must work on a phone at 390 px wide, in light and dark mode.
- TypeScript is pinned to `~5.9.3` in both `package.json` files. Do not upgrade it.

## Secrets and deployment
- Never read, print or commit `api/local.settings.json` or `.env*` files, and never ask for keys, connection
  strings, the Entra client secret, the SWA deployment token or `JOBS_KEY`. They live in SWA app settings and
  GitHub secrets.
- A push to `main` deploys to production. Do not push, run `az` commands that change Azure resources, or set
  GitHub secrets unless the user asks for that specific action.
