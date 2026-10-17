-- Add the `achievement` XP source.
--
-- This must be its own migration file: PostgreSQL allows `ALTER TYPE … ADD VALUE`
-- inside a transaction block, but the new value cannot be *used* until that
-- transaction commits, so the core-loop engine (which awards achievement XP)
-- cannot live in the same file.
alter type public.xp_source add value if not exists 'achievement';
