CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  invite_code TEXT UNIQUE NOT NULL,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS team_members (
  team_id UUID REFERENCES teams(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member')),
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (team_id, user_id)
);

CREATE TABLE IF NOT EXISTS usage_snapshots (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  recorded_at TIMESTAMPTZ DEFAULT now(),
  session_pct INTEGER,
  week_all_pct INTEGER,
  week_sonnet_pct INTEGER,
  extra_pct INTEGER,
  session_input_tokens BIGINT DEFAULT 0,
  session_output_tokens BIGINT DEFAULT 0,
  session_cache_read_tokens BIGINT DEFAULT 0,
  session_cache_write_tokens BIGINT DEFAULT 0,
  messages INTEGER DEFAULT 0,
  tool_calls INTEGER DEFAULT 0,
  model TEXT,
  total_sessions INTEGER DEFAULT 0,
  total_messages INTEGER DEFAULT 0,
  today_messages INTEGER DEFAULT 0,
  estimated_cost_usd NUMERIC(10, 4) DEFAULT 0,
  last_active TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_snapshots_user_recorded ON usage_snapshots(user_id, recorded_at DESC);
