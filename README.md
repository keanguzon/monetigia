<div align="center">

  <img src="public/logos/main-logo.png" alt="Monetigia Logo" width="80" height="80" style="border-radius: 18px;" />

  # Monetigia

  **Personal finance tracker designed for clarity, cashflow control, and dual-cadence goal tracking.**

  <p>
    <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-14.1.0-black?style=flat-square&logo=next.js" alt="Next.js" /></a>
    <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5.0-blue?style=flat-square&logo=typescript" alt="TypeScript" /></a>
    <a href="https://supabase.com"><img src="https://img.shields.io/badge/Supabase-PostgreSQL-3ECF8E?style=flat-square&logo=supabase" alt="Supabase" /></a>
    <a href="https://tailwindcss.com"><img src="https://img.shields.io/badge/Tailwind_CSS-3.3-38B2AC?style=flat-square&logo=tailwind-css" alt="Tailwind CSS" /></a>
    <a href="https://swr.vercel.app"><img src="https://img.shields.io/badge/SWR-State_Cache-black?style=flat-square" alt="SWR" /></a>
  </p>

  <p>
    <em>From Latin <strong>Moneta</strong> (money) and <strong>Vestigia</strong> (footprints / tracks).</em><br />
    Trace every footprint of your wealth across cash, bank vaults, credit cards, and sinking funds.
  </p>

</div>

---

## Highlights

### 🎯 Flexible Goals & Sinking Funds
- **Dual Cadence Projections:** Set savings targets in either **Monthly** or **Kinsenas (Semi-Monthly)** paydays with live bi-directional conversion.
- **Tag-Based Auto Tracking:** Assign transaction tags to automatically accrue progress toward active goals.
- **Milestone Projections:** Real-time time-to-goal projections based on planned savings targets and historical savings.
- **Hallmark Visual Hierarchy:** Borderless editorial masthead, clean progress tracks, and priority flagging.

### 💳 Multi-Vault Account Management
- **Dedicated Account Types:** Manage Cash, High-Yield Savings (e.g., Maya, SeaBank, GoTyme), Traditional Banks, Credit Cards, and PayLater/BNPL ledgers.
- **Debt & PayLater Amortization:** Built-in schedule engine for managing credit balances, cutoff dates, and debt payoff timelines.
- **Two-Way Transfers:** Record internal transfers between accounts without skewing expense or income reports.

### 📊 Real-Time Analytics & Transactions
- **Dashboard Overview:** Income, expenses, net savings rate, and account distribution at a glance.
- **Transaction Spec Sheet:** Filter, search, and categorize entries with custom color badges and notes.
- **Fast Optimistic Updates:** Powered by SWR for instant client-side UI feedback and background revalidation.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | [Next.js 14](https://nextjs.org/) (App Router, Server Actions, Middleware) |
| **Language** | [TypeScript](https://www.typescriptlang.org/) |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) with [shadcn/ui](https://ui.shadcn.com/) primitives |
| **Icons** | [Lucide React](https://lucide.dev/) |
| **State & Fetching** | [SWR](https://swr.vercel.app/) (Stale-While-Revalidate caching) |
| **Database & Auth** | [Supabase](https://supabase.com/) (PostgreSQL with Row Level Security, OAuth & Email Auth) |
| **Charts** | [Chart.js](https://www.chartjs.org/) with [react-chartjs-2](https://react-chartjs-2.js.org/) |

---

## Getting Started

### Prerequisites
- Node.js 18.17 or higher
- npm, pnpm, or yarn
- A Supabase account and project

### 1. Clone the repository
```bash
git clone https://github.com/keanguzon/monetigia.git
cd monetigia
```

### 2. Install dependencies
```bash
npm install
```

### 3. Configure environment variables
Create a `.env.local` file in the root directory:
```env
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Database Setup
1. In your Supabase dashboard, open the **SQL Editor**.
2. Run the migration script located at `supabase/schema.sql` to initialize tables, indexes, and Row Level Security (RLS) policies.
3. Configure your desired auth providers under **Authentication > Providers** (e.g. Google OAuth).

### 5. Run local development server
```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

---

## Project Structure

```text
monetigia/
├── public/                 # Static assets, bank & wallet logos, brand icons
├── src/
│   ├── app/
│   │   ├── (auth)/         # Auth routes (login, register, reset-password, callback)
│   │   ├── (dashboard)/    # Authenticated dashboard views
│   │   │   ├── accounts/   # Wallets, bank vaults & debt schedule
│   │   │   ├── categories/ # Spending and income category management
│   │   │   ├── dashboard/  # Financial summary & analytics
│   │   │   ├── goals/      # Goals & sinking funds roadmap
│   │   │   ├── settings/   # User profile, preferences, & security
│   │   │   └── transactions/# Ledger search, filters, & transaction history
│   │   ├── api/            # API endpoints (storage, profile avatar uploads)
│   │   ├── globals.css     # Design tokens, theme variables, animations
│   │   └── layout.tsx      # Root layout, fonts, and theme providers
│   ├── components/
│   │   ├── accounts/       # Wallet cards, debt scheduler, account forms
│   │   ├── dashboard/      # Stat cards, balance widgets, activity charts
│   │   ├── goals/          # GoalCard, AddGoalModal, cadence toggles
│   │   ├── layout/         # Sidebar navigation, top header, user menu
│   │   ├── theme/          # Theme toggle & transition overlay
│   │   ├── transactions/   # AddTransactionModal, spec sheet list
│   │   └── ui/             # Reusable shadcn/ui components (Dialog, Button, Input, etc.)
│   ├── hooks/              # Custom SWR hooks (useGoals, useAccounts, useTransactions)
│   ├── lib/                # Utility helpers, currency formatters, supabase clients
│   └── types/              # Database models and TypeScript definitions
├── supabase/               # SQL schema definitions, migrations, and storage policies
└── tailwind.config.ts      # Tailwind design system configuration
```

---

## Available Scripts

- `npm run dev` — Starts the Next.js local development server.
- `npm run build` — Compiles the production application bundle.
- `npm run start` — Runs the production build locally.
- `npm run lint` — Runs ESLint checks across all project files.

---

## Author

Built by **[Kean Guzon](https://github.com/keanguzon)**.
