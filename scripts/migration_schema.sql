-- ============================================================
-- Base44 → Supabase Migration Schema
-- Run this in Supabase Dashboard > SQL Editor
-- Project: hvvrbpvsgjxiicigkwhu
-- Date: 2026-05-19
-- ============================================================

-- UNFILTR APP TABLES
CREATE TABLE IF NOT EXISTS public.unfiltr_user_profiles (
  id TEXT PRIMARY KEY,
  apple_user_id TEXT,
  email TEXT,
  display_name TEXT,
  companion_id TEXT,
  background_id TEXT,
  is_premium BOOLEAN DEFAULT FALSE,
  annual_plan BOOLEAN DEFAULT FALSE,
  pro_plan BOOLEAN DEFAULT FALSE,
  premium BOOLEAN DEFAULT FALSE,
  subscription_expires TIMESTAMPTZ,
  message_count INTEGER DEFAULT 0,
  bonus_messages INTEGER DEFAULT 0,
  referral_code TEXT,
  referral_count INTEGER DEFAULT 0,
  session_memory JSONB DEFAULT '[]',
  memory_summary TEXT,
  user_facts TEXT,
  push_token TEXT,
  push_enabled BOOLEAN DEFAULT FALSE,
  daily_checkins_enabled BOOLEAN DEFAULT FALSE,
  onboarding_complete BOOLEAN DEFAULT FALSE,
  onboarding_step INTEGER DEFAULT 0,
  tokens_used_today FLOAT DEFAULT 0,
  tokens_used_total FLOAT DEFAULT 0,
  estimated_cost_usd FLOAT DEFAULT 0,
  last_active TIMESTAMPTZ,
  last_seen TIMESTAMPTZ,
  account_paused BOOLEAN DEFAULT FALSE,
  account_paused_at TIMESTAMPTZ,
  account_pause_until TIMESTAMPTZ,
  account_delete_requested BOOLEAN DEFAULT FALSE,
  account_delete_requested_at TIMESTAMPTZ,
  rating_prompted BOOLEAN DEFAULT FALSE,
  source_app TEXT DEFAULT 'unfiltr',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.unfiltr_messages (
  id TEXT PRIMARY KEY,
  apple_user_id TEXT,
  user_profile_id TEXT,
  companion_id TEXT,
  role TEXT,
  content TEXT,
  emotional_tone TEXT,
  session_date TIMESTAMPTZ,
  source_app TEXT DEFAULT 'unfiltr',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_unfiltr_messages_apple ON public.unfiltr_messages(apple_user_id);

CREATE TABLE IF NOT EXISTS public.unfiltr_companions (
  id TEXT PRIMARY KEY,
  name TEXT,
  avatar_url TEXT,
  mood_mode TEXT,
  personality TEXT,
  voice_gender TEXT,
  voice_personality TEXT,
  source_app TEXT DEFAULT 'unfiltr',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.unfiltr_journal_entries (
  id TEXT PRIMARY KEY,
  apple_user_id TEXT,
  user_profile_id TEXT,
  title TEXT,
  content TEXT,
  mood TEXT,
  companion_name TEXT,
  images JSONB DEFAULT '[]',
  stickers JSONB DEFAULT '[]',
  source_app TEXT DEFAULT 'unfiltr',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.unfiltr_error_logs (
  id TEXT PRIMARY KEY,
  error_type TEXT,
  severity TEXT,
  function_name TEXT,
  error_message TEXT,
  error_stack TEXT,
  context TEXT,
  apple_user_id TEXT,
  source_app TEXT DEFAULT 'unfiltr',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- SPORTS WAGER HELPER TABLES
CREATE TABLE IF NOT EXISTS public.swh_purchase_audits (
  id TEXT PRIMARY KEY,
  user_email TEXT,
  platform TEXT,
  product_id TEXT,
  transaction_id TEXT,
  purchase_token TEXT,
  amount FLOAT,
  status TEXT,
  error_message TEXT,
  verification_result TEXT,
  granted_subscription TEXT,
  granted_credits TEXT,
  manually_activated_by TEXT,
  manual_activation_reason TEXT,
  source_app TEXT DEFAULT 'sports_wager_helper',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- UNFILTR FAMILY TABLES
CREATE TABLE IF NOT EXISTS public.family_members (
  id TEXT PRIMARY KEY,
  name TEXT,
  relationship TEXT,
  phone TEXT,
  email TEXT,
  photo_url TEXT,
  video_call_link TEXT,
  is_caregiver BOOLEAN DEFAULT FALSE,
  emergency_contact BOOLEAN DEFAULT FALSE,
  source_app TEXT DEFAULT 'unfiltr_family',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.family_medications (
  id TEXT PRIMARY KEY,
  name TEXT,
  dosage TEXT,
  frequency TEXT,
  time_of_day JSONB DEFAULT '[]',
  with_food BOOLEAN DEFAULT FALSE,
  instructions TEXT,
  prescribing_doctor TEXT,
  start_date TEXT,
  end_date TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  source_app TEXT DEFAULT 'unfiltr_family',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.family_appointments (
  id TEXT PRIMARY KEY,
  title TEXT,
  type TEXT,
  date TEXT,
  time TEXT,
  location TEXT,
  doctor_name TEXT,
  notes TEXT,
  transportation_needed BOOLEAN DEFAULT FALSE,
  reminder_sent BOOLEAN DEFAULT FALSE,
  source_app TEXT DEFAULT 'unfiltr_family',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.family_activities (
  id TEXT PRIMARY KEY,
  title TEXT,
  description TEXT,
  category TEXT,
  date TEXT,
  time TEXT,
  location TEXT,
  cost TEXT,
  registration_link TEXT,
  image_url TEXT,
  accessibility_notes TEXT,
  is_featured BOOLEAN DEFAULT FALSE,
  source_app TEXT DEFAULT 'unfiltr_family',
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- ART APP TABLES (companion catalog)
CREATE TABLE IF NOT EXISTS public.art_companions (
  id TEXT PRIMARY KEY,
  name TEXT,
  avatar_url TEXT,
  mood_mode TEXT,
  personality TEXT,
  voice_gender TEXT,
  voice_personality TEXT,
  source_app TEXT DEFAULT 'art',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
