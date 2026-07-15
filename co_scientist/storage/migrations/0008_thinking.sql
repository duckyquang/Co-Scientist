-- Migration 0008: capture real agent extended-thinking.
--
-- generation/evolution write `hypotheses.thinking`, reflection writes
-- `reviews.thinking` — the genuine reasoning the model produced, surfaced in
-- the UI. On fresh DBs schema.sql already has these columns; the migration
-- runner tolerates the resulting "duplicate column name" (same pattern as 0002).

ALTER TABLE hypotheses ADD COLUMN thinking TEXT;
ALTER TABLE reviews ADD COLUMN thinking TEXT;
