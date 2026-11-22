-- EllextStore application data schema.
-- Run with the Supabase Postgres connection; this is safe to apply repeatedly.
CREATE TABLE IF NOT EXISTS public.currency_rows (
  id text PRIMARY KEY,
  row_date date NOT NULL,
  image text NOT NULL DEFAULT '',
  description text NOT NULL,
  category text NOT NULL DEFAULT 'Ring',
  usd numeric(14,2) NOT NULL CHECK (usd >= 0),
  product_count integer NOT NULL CHECK (product_count >= 0),
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.currency_rows ADD COLUMN IF NOT EXISTS category text NOT NULL DEFAULT 'Ring';

CREATE TABLE IF NOT EXISTS public.product_increases (
  source_id text PRIMARY KEY REFERENCES public.currency_rows(id) ON DELETE CASCADE,
  selling_price_inr numeric(14,2) NOT NULL CHECK (selling_price_inr >= 0),
  locked boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.selling_entries (
  source_id text PRIMARY KEY REFERENCES public.currency_rows(id) ON DELETE CASCADE,
  sold_count integer NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
  unit_expense_inr numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_expense_inr >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.selling_entries ADD COLUMN IF NOT EXISTS unit_expense_inr numeric(14,2) NOT NULL DEFAULT 0 CHECK (unit_expense_inr >= 0);

CREATE TABLE IF NOT EXISTS public.product_requests (
  id text PRIMARY KEY,
  name text NOT NULL,
  category text NOT NULL,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'Submitted' CHECK (status IN ('Submitted','Under review','Fulfilled')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.member_invitations (
  email text PRIMARY KEY,
  name text NOT NULL,
  status text NOT NULL DEFAULT 'Pending' CHECK (status IN ('Pending','Accepted','Expired')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.product_categories (
  name text PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.company_expenses (
  id text PRIMARY KEY,
  amount_inr numeric(14,2) NOT NULL CHECK (amount_inr > 0),
  category text NOT NULL DEFAULT 'Other',
  note text NOT NULL,
  expense_date timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.expense_ledger (
  id text PRIMARY KEY,
  amount_inr numeric(14,2) NOT NULL CHECK (amount_inr > 0),
  category text NOT NULL DEFAULT 'Other',
  note text NOT NULL,
  expense_date timestamptz NOT NULL DEFAULT now(),
  created_by text NOT NULL DEFAULT ''
);
ALTER TABLE public.expense_ledger ADD COLUMN IF NOT EXISTS created_by text NOT NULL DEFAULT '';

-- Local browser state can be migrated into this table without exposing it to
-- unauthenticated Data API clients. Server-side code uses the DB connection.
CREATE TABLE IF NOT EXISTS public.dashboard_snapshots (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  storage_key text NOT NULL CHECK (storage_key IN (
    'ellextstore:v1:cart', 'ellextstore:v1:wishlist', 'ellextstore:v1:product-requests',
    'ellextstore:v1:member-invitations', 'ellextstore:v1:currency-rows',
    'ellextstore:v1:currency-rate', 'ellextstore:v1:product-increases',
    'ellextstore:v1:selling-entries'
  )),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, storage_key)
);

-- Shared company state is intentionally global across Admin and Super Admin
-- accounts. Personal cart and wishlist remain in browser storage.
CREATE TABLE IF NOT EXISTS public.dashboard_shared_state (
  storage_key text PRIMARY KEY CHECK (storage_key IN (
    'ellextstore:v1:currency-rows', 'ellextstore:v1:currency-rate',
    'ellextstore:v1:product-increases', 'ellextstore:v1:selling-entries',
    'ellextstore:v1:product-categories'
  )),
  payload jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.currency_rows ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_increases ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.selling_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_requests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.member_invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.product_categories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.company_expenses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.expense_ledger ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_snapshots ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.dashboard_shared_state ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON public.currency_rows, public.product_increases, public.selling_entries,
  public.product_requests, public.member_invitations, public.product_categories,
  public.company_expenses, public.expense_ledger, public.dashboard_snapshots, public.dashboard_shared_state
  FROM anon, authenticated;
GRANT ALL ON public.currency_rows, public.product_increases, public.selling_entries,
  public.product_requests, public.member_invitations, public.product_categories,
  public.company_expenses, public.expense_ledger, public.dashboard_snapshots, public.dashboard_shared_state TO service_role;
