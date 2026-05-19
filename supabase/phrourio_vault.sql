-- Phrourio Vault: encrypted password manager integrated into Rune
-- Passwords are AES-256-GCM encrypted. Key is in VAULT_ENCRYPTION_KEY env var.

CREATE TABLE IF NOT EXISTS phrourio_vault (
  id TEXT PRIMARY KEY,
  service_name TEXT,
  username TEXT,
  encrypted_password TEXT NOT NULL,
  iv TEXT NOT NULL,
  url TEXT,
  category TEXT DEFAULT 'Other',
  notes TEXT DEFAULT '',
  favorite BOOLEAN DEFAULT FALSE,
  is_weak BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE phrourio_vault ENABLE ROW LEVEL SECURITY;

-- Only service role can read/write (owner-only vault)
CREATE POLICY IF NOT EXISTS vault_service_only
  ON phrourio_vault
  FOR ALL
  USING (auth.role() = 'service_role');

-- deploy trigger 1779162879