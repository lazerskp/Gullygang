-- ============================================================
-- ODIVERSE SUPPORTERS SCHEMA ENHANCEMENT (RAZORPAY INTEGRATION)
-- Adds support for Razorpay payment IDs, orders, display names, and statuses
-- ============================================================

CREATE TABLE IF NOT EXISTS supporters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL DEFAULT 'Anonymous',
  display_name TEXT NOT NULL DEFAULT 'Anonymous',
  email TEXT NOT NULL DEFAULT '',
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_provider TEXT NOT NULL DEFAULT 'razorpay',
  cashfree_order_id TEXT,
  cashfree_payment_id TEXT,
  razorpay_payment_id TEXT,
  razorpay_order_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'SUCCESS',
  status TEXT NOT NULL DEFAULT 'captured',
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  environment TEXT NOT NULL DEFAULT 'production',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Ensure columns exist in case table was created earlier
ALTER TABLE supporters ADD COLUMN IF NOT EXISTS display_name TEXT DEFAULT 'Anonymous';
ALTER TABLE supporters ADD COLUMN IF NOT EXISTS razorpay_payment_id TEXT;
ALTER TABLE supporters ADD COLUMN IF NOT EXISTS razorpay_order_id TEXT;
ALTER TABLE supporters ADD COLUMN IF NOT EXISTS status TEXT DEFAULT 'captured';

-- Ensure cashfree_order_id is nullable if previously constrained
ALTER TABLE supporters ALTER COLUMN cashfree_order_id DROP NOT NULL;
ALTER TABLE supporters ALTER COLUMN email SET DEFAULT '';

-- Unique index for Razorpay payment idempotency (prevents duplicate webhook inserts)
CREATE UNIQUE INDEX IF NOT EXISTS idx_supporters_rzp_payment_id ON supporters(razorpay_payment_id) WHERE razorpay_payment_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_supporters_status_amt ON supporters(status, amount DESC);
CREATE INDEX IF NOT EXISTS idx_supporters_display_name ON supporters(display_name);
CREATE INDEX IF NOT EXISTS idx_supporters_created ON supporters(created_at DESC);
