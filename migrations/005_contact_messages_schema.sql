-- ============================================================
-- GULLYGANG / ODIVERSE CONTACT MESSAGES SCHEMA
-- Production-safe visitor message storage with strict Insert-Only RLS
-- ============================================================

CREATE TABLE IF NOT EXISTS contact_messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  message TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for administrative query performance
CREATE INDEX IF NOT EXISTS idx_contact_messages_created ON contact_messages(created_at DESC);

-- Enable Row Level Security (RLS)
ALTER TABLE contact_messages ENABLE ROW LEVEL SECURITY;

-- Clean up any prior policies
DROP POLICY IF EXISTS "Allow public insert to contact_messages" ON contact_messages;
DROP POLICY IF EXISTS "Allow admin full access to contact_messages" ON contact_messages;
DROP POLICY IF EXISTS "Allow public read contact_messages" ON contact_messages;
DROP POLICY IF EXISTS "Allow public update contact_messages" ON contact_messages;
DROP POLICY IF EXISTS "Allow public delete contact_messages" ON contact_messages;

-- RLS Policy: Allow public/anon to INSERT messages only
-- Since NO SELECT, UPDATE, or DELETE policies are granted, PostgREST / REST clients
-- are strictly denied from reading, modifying, or deleting any contact messages.
CREATE POLICY "Allow public insert to contact_messages"
ON contact_messages
FOR INSERT
TO anon, authenticated
WITH CHECK (true);
