# Chikerito — Full-Stack Scaffold

The Operating System for Life's Biggest Moments.

This is a working full-stack scaffold for Chikerito: a milestone planning + fundraising
platform whose standout feature is the **Finance Hub / Expense Tracker** — it doesn't just
track donations, it tracks where the money goes.

## Quickest start (one command)

Requires Node.js 18+.

**macOS/Linux:**
```
./start.sh
```

**Windows:** double-click `start.bat`, or from a terminal:
```
start.bat
```

Either one installs dependencies on first run, seeds demo data, and starts both the backend
(`:4000`) and frontend (`:5173`) together. Then open **http://localhost:5173**.

Demo login: `demo@chikerito.com` / `chikerito123` (pre-loaded with the Clinton & Mary wedding
fund example).

To stop, press `Ctrl+C` once — it shuts down both processes.

## What's included

- **backend/** — Node/Express REST API
  - JWT auth (register/login)
  - Life Spaces (milestones), Budget Categories, Expenses, Contributions, Tasks, Team members, Notifications
  - PostgreSQL-backed production persistence, migrations, and a one-time JSON importer
  - `db.js` remains the zero-service development/test store; production requires `DATABASE_URL`
  - `seed.js` — seeds a demo account and the "Clinton & Mary's Wedding Fund" example data
- **frontend/** — React 18 + Vite SPA
  - Public marketing site (Landing page: hero, templates, features, how it works, pricing, FAQ)
  - Auth pages (Login / Register)
  - Public donation page (`/donate/:slug`) — no login required, records a contribution
  - Client app ("Mission Control") behind auth:
    - Dashboard — goal/raised/spent/available stats, spending-by-category chart, financial health score, notifications, recent contributions
    - My Life Spaces — create/manage milestone workspaces, copy public share link
    - Event Planning — Timeline (tasks grouped by due month, with relative "in 2 months" /
      "3 days overdue" labels) and Checklist (tasks grouped by category, e.g. Venue,
      Photography, Dress) views over one shared task list
    - Finance Hub — budget categories with live raised/spent/remaining tracking
    - Budget Spreadsheet — planned-vs-actual grid: inline-editable category budgets and per-line-item
      planned/actual amounts, live variance, income vs. expense totals, and CSV export
    - Expense Tracker — record vendor expenses, receipts, status
    - Contributions — searchable transaction list + share link
    - Analytics — budget vs. actual bar chart, monthly spend trend
    - Team — invite collaborators with roles (Finance Manager, Event Planner, Volunteer, Editor)
    - Settings — edit milestone details and Event Visibility (Private / Public), with per-page controls for
      whether the budget breakdown is public, search-engine indexing, and an optional passcode; includes a
      "Preview Public Page" link and copyable share URL

## Running it manually (two terminals)

If you'd rather run each piece yourself instead of `start.sh` / `start.bat`:

### 1. Backend
```
cd backend
npm install
cp .env.example .env      # optional — defaults work out of the box
npm run seed               # creates demo data
npm start                   # runs on http://localhost:4000
```

### 2. Frontend
```
cd frontend
npm install
npm run dev                 # runs on http://localhost:5173
```

The Vite dev server proxies `/api/*` to `http://localhost:4000`.

### Production build
```
cd frontend && npm run build     # outputs frontend/dist
cd backend && npm start          # serve the API, and host dist/ behind any static file server or nginx
```

## What's a scaffold vs. production-ready

Production uses PostgreSQL and Stripe Checkout. Public donations are counted only after a
signed `checkout.session.completed` webhook reports a paid session. Auth tokens are tied to
revocable server-side sessions, and password recovery is delivered through a configurable
HTTPS mail-service endpoint.

Receipt and invoice fields are references only; the current UI does not upload file bytes, so
object storage is not part of the launch scope. AI Builder and AI Finance Assistant remain
future enhancements and are not required to operate the current product.

## Production deployment

1. Copy `.env.example` into your secret manager and set every variable marked as required.
2. Install dependencies with `npm ci` in `backend/` and `frontend/`.
3. Run `npm run db:migrate --prefix backend` against an empty PostgreSQL database.
4. If upgrading an existing JSON deployment, back it up and run
   `npm run db:import-json --prefix backend -- /absolute/path/to/db.json` once.
5. Configure Stripe to send signed webhooks to `/api/payments/stripe/webhook`.
6. Build the frontend with `npm run build --prefix frontend`, then start the API.

The PostgreSQL adapter serializes mutations with a transaction-level advisory lock, preserving
the existing domain behavior without lost updates. Horizontal API replicas are safe, though
the whole-state transaction model is intended for the current MVP scale and should be profiled
before high-volume use.

## Project structure

```
chikerito/
  start.sh / start.bat   one-command startup for mac/linux / windows
  package.json            root orchestration (concurrently runs both apps)
  backend/
    server.js               entrypoint
    db.js                    JSON datastore matching schema.sql
    schema.sql                reference relational schema
    seed.js                    demo data
    middleware/auth.js         JWT auth middleware
    routes/
      auth.js
      lifespaces.js
      categories.js
      expenses.js
      contributions.js
      tasks.js
      dashboard.js
  frontend/
    src/
      api.js                  API client
      context/                 Auth + active-Life-Space state
      components/               Sidebar, Topbar, ProtectedRoute
      pages/                     Landing, Login, Register, DonatePage, Dashboard,
                                  LifeSpaces, Planning, FinanceHub, BudgetSpreadsheet, ExpenseTracker,
                                  Contributions, Analytics, Team, Settings
      styles.css                 Brand design system (navy / royal blue / gold, luxury-minimal)
```
