-- ============================================================
-- Rune missing tables migration
-- Run in: https://supabase.com/dashboard/project/hvvrbpvsgjxiicigkwhu/sql
-- ============================================================

-- 1. rune_reminders
CREATE TABLE IF NOT EXISTS public.rune_reminders (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title         text NOT NULL,
  body          text,
  scheduled_at  timestamptz NOT NULL,
  status        text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','sent','cancelled')),
  created_at    timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rune_reminders_status_scheduled
  ON public.rune_reminders (status, scheduled_at);

ALTER TABLE public.rune_reminders ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rune_reminders' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.rune_reminders
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 2. rune_outbox  (fire-and-forget email/push queue)
CREATE TABLE IF NOT EXISTS public.rune_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  channel       text NOT NULL CHECK (channel IN ('email','push','whatsapp')),
  recipient     text,
  subject       text,
  body          text NOT NULL,
  status        text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','sent','failed')),
  attempts      int  NOT NULL DEFAULT 0,
  error         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  sent_at       timestamptz
);

CREATE INDEX IF NOT EXISTS idx_rune_outbox_status
  ON public.rune_outbox (status, created_at);

ALTER TABLE public.rune_outbox ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'rune_outbox' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.rune_outbox
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

-- 3. briefing_log — store daily briefing output for history
CREATE TABLE IF NOT EXISTS public.briefing_log (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  content       text NOT NULL,
  sent_via      text DEFAULT 'whatsapp',
  created_at    timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.briefing_log ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'briefing_log' AND policyname = 'service_role_all'
  ) THEN
    CREATE POLICY service_role_all ON public.briefing_log
      FOR ALL USING (auth.role() = 'service_role');
  END IF;
END $$;

SELECT 'Migration complete ✅' as result;
