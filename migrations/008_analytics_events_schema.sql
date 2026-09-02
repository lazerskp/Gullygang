-- ============================================================
-- GULLYGANG — FIRST-PARTY ANALYTICS & CONTENT INTELLIGENCE SCHEMA
-- Lightweight, privacy-first event tracking & aggregation indexes
-- ============================================================

CREATE TABLE IF NOT EXISTS analytics_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type VARCHAR(64) NOT NULL,
  page_type VARCHAR(64),
  page_path VARCHAR(512),
  article_id UUID,
  playlist_id UUID,
  track_id VARCHAR(64),
  tag VARCHAR(128),
  search_query VARCHAR(256),
  metadata JSONB DEFAULT '{}'::jsonb,
  session_id VARCHAR(64),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Performance indexes for dashboard aggregation queries
CREATE INDEX IF NOT EXISTS idx_analytics_created_at ON analytics_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_analytics_event_type ON analytics_events(event_type);
CREATE INDEX IF NOT EXISTS idx_analytics_article_id ON analytics_events(article_id) WHERE article_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_search_query ON analytics_events(search_query) WHERE search_query IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_tag ON analytics_events(tag) WHERE tag IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_analytics_session_id ON analytics_events(session_id) WHERE session_id IS NOT NULL;
