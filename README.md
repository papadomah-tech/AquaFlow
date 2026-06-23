# AquaFlow Manager — Web App
## VeeBee Ventures · Crystal Purified Water · Ghana

Next.js 14 + Supabase progressive web app. Multi-user, mobile-first.

---

## 5-Step Deployment

### Step 1 — Create Supabase Project
1. Go to https://app.supabase.com → New Project → name it `aquaflow`
2. SQL Editor → paste contents of `supabase/schema.sql` → Run
3. Settings → API → copy Project URL and anon key

### Step 2 — Create First Admin User
1. Supabase → Authentication → Users → Invite User → enter email
2. User receives email with password link
3. After signup: Table Editor → profiles → set role to `admin`

### Step 3 — Deploy to Vercel
```bash
# Push to GitHub, then:
# Vercel dashboard → Import Project → select repo → Deploy
```

### Step 4 — Set Environment Variables on Vercel
```
NEXT_PUBLIC_SUPABASE_URL      = https://YOUR_ID.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY = your_anon_key
SUPABASE_SERVICE_ROLE_KEY     = your_service_role_key
```

### Step 5 — Install on Mobile (PWA)
**Android:** Chrome → ⋮ menu → Add to Home Screen
**iPhone:** Safari → Share → Add to Home Screen

---

## Architecture
```
Browser / Mobile → Vercel (Next.js) → Supabase (PostgreSQL)
```

## Roles
| Role | Access |
|------|--------|
| admin | Full access + user management |
| manager | All data, edit/delete |
| operator | Data entry (sales, production, expenses) |
| viewer | Read-only |

## Modules Built
| Module | Status |
|--------|--------|
| Login / Auth | Complete |
| Dashboard | Complete |
| Raw Materials | Complete |
| Production | Complete |
| Stock + Stock Take | Complete |
| Pricing Calculator | Complete |
| Sales | Complete |
| Expenses | Complete |
| Cash & Bank Reconciliation | Complete |
| Personnel + Performance Pay | Complete |
| Reports (P&L + Salesperson) | Complete |
| Settings / User Management | Complete |
