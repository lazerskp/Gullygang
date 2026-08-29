-- ============================================================
-- ODIVERSE SUPPORTERS DATABASE SCHEMA
-- Dedicated table for Cashfree Sandbox / Production Support payments
-- ============================================================

CREATE TABLE IF NOT EXISTS supporters (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  amount NUMERIC(10, 2) NOT NULL,
  currency TEXT NOT NULL DEFAULT 'INR',
  payment_provider TEXT NOT NULL DEFAULT 'cashfree',
  cashfree_order_id TEXT NOT NULL UNIQUE,
  cashfree_payment_id TEXT,
  payment_status TEXT NOT NULL DEFAULT 'PENDING',
  is_anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  environment TEXT NOT NULL DEFAULT 'sandbox',
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexes for high-performance querying and idempotency
CREATE INDEX IF NOT EXISTS idx_supporters_status ON supporters(payment_status);
CREATE INDEX IF NOT EXISTS idx_supporters_order_id ON supporters(cashfree_order_id);
CREATE INDEX IF NOT EXISTS idx_supporters_created ON supporters(created_at DESC);
