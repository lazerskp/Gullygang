-- ============================================================
-- GULLYGANG / ODIVERSE STEP 7 BLOG CMS SCHEMA UPGRADE
-- Adds tags, is_featured, scheduled_at to blog_posts
-- ============================================================

-- 1. Add missing editorial columns to blog_posts
ALTER TABLE blog_posts 
ADD COLUMN IF NOT EXISTS tags TEXT[] DEFAULT '{}'::text[],
ADD COLUMN IF NOT EXISTS is_featured BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS scheduled_at TIMESTAMPTZ DEFAULT NULL;

-- 2. Create indices for fast scheduled publishing & featured queries
CREATE INDEX IF NOT EXISTS idx_blog_posts_scheduled ON blog_posts(status, scheduled_at);
CREATE INDEX IF NOT EXISTS idx_blog_posts_featured ON blog_posts(is_featured) WHERE is_featured = true;
