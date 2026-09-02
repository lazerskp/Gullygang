-- ============================================================
-- GULLYGANG — GROWTH INTELLIGENCE & PERFORMANCE INDEXES
-- Composite indexes for high-speed time-series analytics aggregation
-- ============================================================

CREATE INDEX IF NOT EXISTS idx_analytics_type_created 
  ON analytics_events(event_type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_analytics_article_event 
  ON analytics_events(article_id, event_type, created_at DESC) 
  WHERE article_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_search_event 
  ON analytics_events(event_type, search_query, created_at DESC) 
  WHERE search_query IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_analytics_session_created 
  ON analytics_events(session_id, created_at DESC) 
  WHERE session_id IS NOT NULL;
