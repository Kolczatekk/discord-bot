-- SQL script to run in Supabase SQL Editor
-- Creates the user_spent table for tracking customer spent amount in PLN

CREATE TABLE IF NOT EXISTS public.user_spent (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, guild_id)
);

-- Enable Row Level Security (RLS)
ALTER TABLE public.user_spent ENABLE ROW LEVEL SECURITY;

-- Allow read access only for authenticated (service_role) users
CREATE POLICY "Allow authenticated read access" ON public.user_spent
    FOR SELECT TO authenticated USING (true);

-- Allow write access only for authenticated (service_role) users
CREATE POLICY "Allow authenticated write access" ON public.user_spent
    FOR ALL TO authenticated USING (true) WITH CHECK (true);
