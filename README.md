# Monetigia

> **Monetigia** /mo-ne-ti-ja/  
> From Latin *Moneta* (money) and *Vestigia* (tracks). A premium personal finance tracker designed for clarity and control.

## Overview
Monetigia helps you trace every footprint of your wealth. It seamlessly consolidates multiple accounts, wallets, and budgets into visual reports, all secured directly via Supabase OAuth.

## Tech Stack
- **Frontend:** Next.js 14 (App Router), TypeScript, Tailwind CSS, shadcn/ui
- **Backend & Auth:** Supabase (PostgreSQL)
- **Deployment:** Vercel

## Getting Started

### 1. Installation
```bash
npm install
```

### 2. Database Setup
1. Create a new project on [Supabase](https://supabase.com).
2. Run the initialization script located at `supabase/schema.sql` in the Supabase SQL Editor.
3. Enable your preferred OAuth providers (e.g., Google) under **Authentication > Providers**.

### 3. Environment Variables
Copy `.env.local.example` to `.env.local` and fill in your Supabase credentials:
```env
NEXT_PUBLIC_SUPABASE_URL=your_supabase_url
NEXT_PUBLIC_SUPABASE_ANON_KEY=your_anon_key
SUPABASE_SERVICE_ROLE_KEY=your_service_role_key
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

### 4. Run Development Server
```bash
npm run dev
```

---

Built with 💚 by Kean Guzon
