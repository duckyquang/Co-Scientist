-- Migration 0006: chat follow-up transcript.
--
-- Backs the session-page chat box (question / tweak-rerun / out-of-scope).
-- One row per turn; assistant `tweak` rows carry the spawned `new_session_id`.

CREATE TABLE IF NOT EXISTS chat_messages (
    id             TEXT PRIMARY KEY,
    session_id     TEXT NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    created_at     TEXT NOT NULL,
    role           TEXT NOT NULL,          -- 'user' | 'assistant'
    intent         TEXT,                   -- null for user rows
    text           TEXT NOT NULL,
    new_session_id TEXT                    -- set on assistant tweak rows
);
CREATE INDEX IF NOT EXISTS chat_msg_session ON chat_messages(session_id, created_at);
