-- SQL script to run in Supabase SQL Editor
-- Creates the user_spent table for tracking customer spent amount in PLN

CREATE TABLE IF NOT EXISTS public.user_spent (
    user_id TEXT NOT NULL,
    guild_id TEXT NOT NULL,
    amount NUMERIC NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (user_id, guild_id)
);

-- Enable Row Level Security (RLS) if required
ALTER TABLE public.user_spent ENABLE ROW LEVEL SECURITY;

-- Allow public read access
CREATE POLICY "Allow public read access" ON public.user_spent
    FOR SELECT USING (true);

-- Allow write access for everyone (or configure authenticated only)
CREATE POLICY "Allow write access for all" ON public.user_spent
    FOR ALL USING (true) WITH CHECK (true);
