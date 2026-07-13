-- Migration 0007: rerun-chain linkage.
--
-- A chat "tweak" spawns a NEW session; origin_session_id points at the chain's
-- ROOT session (child.origin = parent.origin ?? parent.id), so the dashboard
-- can collapse a rerun chain into a single card. NULL = the session is its own
-- root. On fresh DBs schema.sql already has the column; the migration runner
-- tolerates the resulting "duplicate column name" (same pattern as 0002).

ALTER TABLE sessions ADD COLUMN origin_session_id TEXT;
