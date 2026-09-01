-- ============================================================
-- GULLYGANG / ODIVERSE STEP 4 ADMIN SCHEMA MIGRATION
-- Adds blog_posts table, playlist_songs is_active column,
-- and seeds initial settings for Admin Management
-- ============================================================

-- 1. Create blog_posts table for dynamic editorial articles
CREATE TABLE IF NOT EXISTS blog_posts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT UNIQUE NOT NULL,
  title TEXT NOT NULL,
  excerpt TEXT,
  content TEXT NOT NULL,
  featured_image TEXT,
  reading_time TEXT DEFAULT '5 min read',
  author TEXT DEFAULT 'GULLYGANG Editorial',
  seo_title TEXT,
  seo_description TEXT,
  status TEXT NOT NULL DEFAULT 'published',
  published_at TIMESTAMPTZ DEFAULT NOW(),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Index for blog post slug and publication date
CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
CREATE INDEX IF NOT EXISTS idx_blog_posts_status_published ON blog_posts(status, published_at DESC);

-- 2. Add is_active column to playlist_songs if missing
ALTER TABLE playlist_songs 
ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT true;

-- 3. Seed initial blog post: Top 10 Rappers in India (2026 Edition)
INSERT INTO blog_posts (slug, title, excerpt, content, featured_image, reading_time, author, seo_title, seo_description, status, published_at)
VALUES (
  'top-10-rappers-in-india',
  'Top 10 Rappers in India (2026 Edition): The Voices Reshaping South Asian Culture',
  'From Mumbai gullies to Punjabi anthems and Delhi drill, discover the definitive editorial ranking of India’s most influential hip-hop artists.',
  '## The Cultural Metamorphosis of Desi Hip-Hop

From the sun-baked alleys of Mumbai’s Dharavi to the hyper-stylized studios of Brampton and Mohali, Indian hip-hop has transcended underground cyphers to become the dominant youth soundtrack of South Asia.

What began in the mid-2010s as a gritty documentation of street realities—spearheaded by pioneers like **DIVINE** and **Naezy**—has metastasized into a multifaceted cultural renaissance spanning drill, trap, melodic Punjabi folk-hop, and raw bilingual storytelling.

### 1. DIVINE — The Architect of Gully Rap
The definitive godfather of Mumbai street rap whose raw cinematic lyricism put Indian hip-hop on the global map.

### 2. Karan Aujla — Global Chart Dominator
Fusing slick Western trap rhythms with unapologetic Punjabi folk melodies, Karan has conquered international streaming charts.

### 3. Seedhe Maut (Calm & Encore ABJ) — The Voice of Delhi Underground
The unparalleled lyricism duo redefining Hindi hip-hop with razor-sharp flows and raw socio-cultural commentary.

### 4. MC Stan — Pune’s Trap Phenomenon
From Pune’s Tadiwala Road to national stardom, MC Stan pioneered Hindi new-school trap, slanguage, and production minimalism.',
  'https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=1200&auto=format&fit=crop&q=80',
  '8 min read',
  'GULLYGANG Editorial',
  'Top 10 Rappers in India (2026) | GULLYGANG',
  'Discover the top 10 rappers in India defining South Asian hip-hop culture in 2026.',
  'published',
  NOW()
)
ON CONFLICT (slug) DO UPDATE 
SET title = EXCLUDED.title,
    excerpt = EXCLUDED.excerpt,
    featured_image = EXCLUDED.featured_image,
    updated_at = NOW();

-- 4. Seed default advertisements and general settings in site_settings
INSERT INTO site_settings (key, value, updated_at)
VALUES (
  'advertisements',
  '{
    "blog_ad_1_active": true,
    "blog_ad_2_active": true,
    "about_ad_1_active": true,
    "about_ad_2_active": true,
    "provider": "adsterra",
    "ad_label": "ADVERTISEMENT"
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;

INSERT INTO site_settings (key, value, updated_at)
VALUES (
  'general_settings',
  '{
    "site_name": "GULLYGANG",
    "tagline": "Music That Feels Different",
    "support_link": "https://pages.razorpay.com/gullygang",
    "instagram_url": "https://instagram.com/gullygang",
    "youtube_url": "https://youtube.com/@gullygang",
    "default_theme": "dark",
    "maintenance_mode": false
  }'::jsonb,
  NOW()
)
ON CONFLICT (key) DO NOTHING;
