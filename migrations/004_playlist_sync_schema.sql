-- ============================================================
-- GULLYGANG PLAYLIST SYNC SCHEMA ENHANCEMENT
-- Adds synchronization metadata, tracking columns, and performance index
-- ============================================================

-- 1. Add synchronization metadata columns to playlists table
ALTER TABLE playlists
ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS sync_status TEXT DEFAULT 'idle',
ADD COLUMN IF NOT EXISTS sync_error TEXT,
ADD COLUMN IF NOT EXISTS sync_stats JSONB DEFAULT '{"total":0,"added":0,"removed":0,"updated":0,"reordered":0}'::jsonb,
ADD COLUMN IF NOT EXISTS sync_interval_mins INTEGER DEFAULT 60;

-- 2. Add performance index on playlist_songs for fast lookups & diffing
CREATE INDEX IF NOT EXISTS idx_playlist_songs_playlist_yt
ON playlist_songs(playlist_id, youtube_id);

CREATE INDEX IF NOT EXISTS idx_playlist_songs_display_order
ON playlist_songs(playlist_id, display_order);
