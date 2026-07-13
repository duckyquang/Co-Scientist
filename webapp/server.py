"""Stdlib HTTP server: JSON API + SSE + static SPA hosting.

No third-party deps — runs with bare `python3 -m webapp.server`. Reads the same
SQLite schema as the real engine; when a session is created from the UI and no
real LLM engine is configured, a background simulator drives it live.

    python -m webapp.server --port 8000 [--db PATH] [--seed]
"""

from __future__ import annotations

import argparse
import hashlib
import json
import mimetypes
import re
import time
from datetime import UTC, datetime, timedelta
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlparse

from . import simulator, store
from .seed import EXTRA_TABLES
from .store import DEFAULT_DB, REPO_ROOT, connect

DIST = REPO_ROOT / "frontend" / "dist"
DB_PATH = DEFAULT_DB

PROVIDERS = [
    {"id": "anthropic", "label": "Anthropic", "models": ["claude-opus-4-7", "claude-sonnet-4-6", "claude-haiku-4-5-20251001"]},
    {"id": "openai", "label": "OpenAI", "models": ["gpt-5", "gpt-4o", "o3-mini"]},
    {"id": "openrouter", "label": "OpenRouter", "models": ["openai/gpt-5", "google/gemini-2.5-pro", "anthropic/claude-3.5-sonnet"]},
    {"id": "gemini", "label": "Google Gemini", "models": ["gemini-2.5-pro", "gemini-2.5-flash"]},
    {"id": "groq", "label": "Groq", "models": ["llama-3.3-70b-versatile"]},
    {"id": "ollama", "label": "Ollama (local)", "models": ["llama3.3:70b", "qwen2.5:32b"]},
]


def _json(handler: "Handler", obj, status=200):
    body = json.dumps(obj, default=str).encode()
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.send_header("Access-Control-Allow-Origin", "*")
    handler.send_header("Cache-Control", "no-store")
    handler.end_headers()
    handler.wfile.write(body)


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def log_message(self, *a):  # quiet
        pass

    # ---- helpers ----
    def _conn(self):
        c = connect(DB_PATH)
        c.executescript(EXTRA_TABLES)
        return c

    def _body_json(self) -> dict:
        n = int(self.headers.get("Content-Length", 0) or 0)
        if not n:
            return {}
        try:
            return json.loads(self.rfile.read(n) or b"{}")
        except json.JSONDecodeError:
            return {}

    # ---- routing ----
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET,POST,OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        q = parse_qs(parsed.query)
        if path.startswith("/api/"):
            return self._api_get(path, q)
        return self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        if path.startswith("/api/"):
            return self._api_post(path)
        return self._json_err(404, "not found")

    def _json_err(self, status, msg):
        _json(self, {"error": msg}, status)

    # ---- API GET ----
    def _api_get(self, path, q):
        conn = self._conn()
        try:
            if path == "/api/meta":
                return _json(self, {
                    "demo_mode": True,
                    "requires_api_key": False,       # server handles auth — no user key needed
                    "default_provider": "groq",
                    "default_model": "llama-3.3-70b-versatile",
                    "providers": PROVIDERS,
                    "models": {
                        "parse_goal": "llama-3.3-70b-versatile",
                        "generation": "llama-3.3-70b-versatile",
                        "reflection": "llama-3.3-70b-versatile",
                        "ranking_pairwise": "llama-3.3-70b-versatile",
                        "metareview_final": "llama-3.3-70b-versatile",
                    },
                    "defaults": {"budget_usd": 5.0, "budget_tokens": 5_000_000,
                                 "n_initial": 4, "wall_clock_seconds": 1800},
                })
            if path == "/api/stats":
                return _json(self, store.global_stats(conn))
            if path == "/api/sessions":
                return _json(self, {"sessions": store.list_sessions(conn)})

            m = re.match(r"^/api/sessions/([^/]+)(/.*)?$", path)
            if m:
                sid, rest = unquote(m.group(1)), (m.group(2) or "")
                return self._session_get(conn, sid, rest, q)
            return self._json_err(404, "unknown endpoint")
        finally:
            conn.close()

    def _session_get(self, conn, sid, rest, q):
        if rest in ("", "/"):
            s = store.get_session(conn, sid)
            if not s:
                return self._json_err(404, "session not found")
            return _json(self, {
                "session": s,
                "metrics": store.metrics(conn, sid),
                "counts": store.session_counts(conn, sid),
                "live": simulator.is_running(sid),
            })
        if rest == "/hypotheses":
            return _json(self, {"hypotheses": store.list_hypotheses(conn, sid)})
        hm = re.match(r"^/hypotheses/([^/]+)$", rest)
        if hm:
            h = store.get_hypothesis(conn, unquote(hm.group(1)))
            return _json(self, h) if h else self._json_err(404, "hypothesis not found")
        if rest == "/matches":
            return _json(self, {"matches": store.list_matches(conn, sid)})
        if rest == "/transcripts":
            return _json(self, {"transcripts": store.list_transcripts(conn, sid)})
        if rest == "/cost":
            return _json(self, {"by_agent": store.cost_by_agent(conn, sid),
                                "summary": store.usage_summary(conn, sid)})
        if rest == "/feedback":
            return _json(self, {"feedback": store.list_feedback(conn, sid)})
        if rest == "/lineage":
            return _json(self, store.lineage(conn, sid))
        if rest == "/clusters":
            return _json(self, {"points": store.clusters(conn, sid)})
        if rest == "/elo-history":
            return _json(self, {"series": store.elo_history_all(conn, sid)})
        if rest == "/events":
            after = int((q.get("after", ["0"])[0]) or 0)
            return _json(self, {"events": store.recent_events(conn, sid, after)})
        if rest == "/overview":
            return self._overview(conn, sid)
        if rest == "/chat":
            return _json(self, {"messages": store.list_chat(conn, sid)})
        if rest == "/stream":
            return self._sse(sid)
        return self._json_err(404, "unknown session endpoint")

    def _overview(self, conn, sid):
        s = store.get_session(conn, sid)
        if not s or not s.get("final_overview"):
            return self._json_err(404, "no overview yet")
        base = (REPO_ROOT / "data").resolve()
        try:
            p = (REPO_ROOT / "data" / s["final_overview"]).resolve()
            p.relative_to(base)
        except (ValueError, OSError):
            return self._json_err(404, "overview unavailable")
        if not p.is_file():
            return self._json_err(404, "overview missing")
        return _json(self, {"markdown": p.read_text()})

    # ---- SSE ----
    def _sse(self, sid):
        self.send_response(200)
        self.send_header("Content-Type", "text/event-stream")
        self.send_header("Cache-Control", "no-cache")
        self.send_header("Connection", "keep-alive")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        last_id = 0
        try:
            conn = connect(DB_PATH)
            # replay recent history first
            for ev in store.recent_events(conn, sid, 0)[-25:]:
                last_id = max(last_id, ev["id"])
                self._sse_send(ev)
            idle = 0
            while True:
                evs = store.recent_events(conn, sid, last_id)
                for ev in evs:
                    last_id = ev["id"]
                    self._sse_send(ev)
                    idle = 0
                # push periodic metrics ticks so gauges update live
                if not evs:
                    idle += 1
                    if idle % 4 == 0:
                        m = store.metrics(conn, sid)
                        s = store.get_session(conn, sid)
                        self.wfile.write(b"event: tick\ndata: " + json.dumps({
                            "metrics": m,
                            "status": s["status"] if s else "unknown",
                            "budget_used_usd": s["budget_used_usd"] if s else 0,
                            "live": simulator.is_running(sid),
                        }, default=str).encode() + b"\n\n")
                        self.wfile.flush()
                self.wfile.write(b": ping\n\n")
                self.wfile.flush()
                time.sleep(1.0)
        except (BrokenPipeError, ConnectionResetError, OSError):
            return

    def _sse_send(self, ev):
        data = json.dumps({"id": ev["id"], "ts": ev["ts"], "agent": ev["agent"],
                           "payload": ev["payload"]}, default=str)
        self.wfile.write(f"event: {ev['event']}\ndata: {data}\n\n".encode())
        self.wfile.flush()

    # ---- API POST ----
    def _api_post(self, path):
        conn = self._conn()
        try:
            if path == "/api/sessions":
                return self._create_session(conn)
            m = re.match(r"^/api/sessions/([^/]+)/(pause|resume|abort)$", path)
            if m:
                sid, action = unquote(m.group(1)), m.group(2)
                status = {"pause": "paused", "resume": "running", "abort": "aborted"}[action]
                conn.execute("UPDATE sessions SET status=?, updated_at=? WHERE id=?",
                             (status, datetime.now(UTC).isoformat(), sid))
                conn.execute(
                    "INSERT INTO events (ts, session_id, agent, event, payload) VALUES (?,?,?,?,?)",
                    (int(time.time() * 1000), sid, "supervisor", f"session_{status}", "{}"))
                conn.commit()
                return _json(self, {"ok": True, "status": status})
            fm = re.match(r"^/api/sessions/([^/]+)/feedback$", path)
            if fm:
                return self._feedback(conn, unquote(fm.group(1)))
            cm = re.match(r"^/api/sessions/([^/]+)/chat$", path)
            if cm:
                return self._chat(conn, unquote(cm.group(1)))
            hm = re.match(r"^/api/sessions/([^/]+)/hypotheses/([^/]+)/state$", path)
            if hm:
                return self._set_hyp_state(conn, unquote(hm.group(1)), unquote(hm.group(2)))
            return self._json_err(404, "unknown endpoint")
        finally:
            conn.close()

    def _start_session(self, conn, goal, *, budget_tokens=5_000_000, budget=None,
                       wall_seconds=1800, n_initial=4, speed=1.0, provider="groq"):
        """Insert a session row + start the simulator. Returns the new session id."""
        from . import content
        if budget is None:
            budget = budget_tokens / 220_000
        sid = "sess_" + hashlib.sha256(f"{goal}{time.time()}".encode()).hexdigest()[:16]
        now_dt = datetime.now(UTC)
        now = now_dt.isoformat()
        wall_deadline = (now_dt + timedelta(seconds=wall_seconds)).isoformat()
        plan = content.make_plan(goal)
        conn.execute(
            """INSERT INTO sessions
               (id, created_at, updated_at, status, research_goal, research_plan,
                config_snapshot, budget_tokens, budget_usd, budget_used_tokens,
                budget_used_usd, wall_deadline, final_overview)
               VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)""",
            (sid, now, now, "running", goal, json.dumps(plan),
             json.dumps({"llm": {"provider": provider},
                         "models": content.MODELS}),
             budget_tokens, budget, 0, 0.0, wall_deadline, None))
        conn.execute(
            "INSERT INTO events (ts, session_id, agent, event, payload) VALUES (?,?,?,?,?)",
            (int(time.time() * 1000), sid, "supervisor", "session_started",
             json.dumps({"goal": goal[:200], "n_initial": n_initial, "budget_tokens": budget_tokens})))
        conn.commit()
        simulator.start(DB_PATH, sid, goal, budget, n_initial=n_initial, speed=speed,
                        budget_tokens=budget_tokens)
        return sid

    def _create_session(self, conn):
        b = self._body_json()
        goal = (b.get("goal") or "").strip()
        if not goal:
            return self._json_err(400, "goal is required")
        budget_tokens = int(b.get("budget_tokens", 5_000_000))
        wall_seconds = int(b.get("wall_clock_seconds", 1800))
        # Legacy dollar cap is optional; the simulator uses it only for its
        # invented per-call cost accounting (displayed as an estimate, not a limit).
        budget = float(b.get("budget_usd", budget_tokens / 220_000))
        n_initial = max(2, min(int(b.get("n_initial", 4)), 50))
        speed = float(b.get("speed", 1.0))
        sid = self._start_session(
            conn, goal, budget_tokens=budget_tokens, budget=budget,
            wall_seconds=wall_seconds, n_initial=n_initial, speed=speed,
            provider=b.get("provider", "groq"))
        return _json(self, {"ok": True, "session_id": sid}, 201)

    def _chat(self, conn, sid):
        from . import content
        b = self._body_json()
        message = (b.get("message") or "").strip()
        if not message:
            return self._json_err(400, "message required")
        session = store.get_session(conn, sid)
        if not session:
            return self._json_err(404, "session not found")

        intent = content.classify_intent(message)
        store.insert_chat(conn, sid, "user", message)
        new_sid = None

        if intent == "out_of_scope":
            reply = content.OUT_OF_SCOPE
        elif intent == "tweak":
            hyps = store.list_hypotheses(conn, sid)
            idea = content.top_idea(hyps, session["research_goal"])
            new_goal = content.compose_rerun_goal(idea, message)
            new_sid = self._start_session(
                conn, new_goal,
                budget_tokens=int(session.get("budget_tokens") or 5_000_000),
                budget=float(session.get("budget_usd") or 0) or None,
                n_initial=4, speed=1.0)
            reply = "Started a new research run based on your change."
        else:  # question
            hyps = store.list_hypotheses(conn, sid)
            reply = content.make_chat_answer(session["research_goal"], hyps)

        store.insert_chat(conn, sid, "assistant", reply,
                          intent=intent, new_session_id=new_sid)
        return _json(self, {"reply_markdown": reply, "intent": intent,
                            "new_session_id": new_sid})

    def _feedback(self, conn, sid):
        b = self._body_json()
        text = (b.get("text") or "").strip()
        kind = b.get("kind", "directive")
        target = b.get("target_id") or None
        if not text:
            return self._json_err(400, "text required")
        fid = "fb_" + hashlib.sha256(f"{sid}{text}{time.time()}".encode()).hexdigest()[:12]
        conn.execute(
            "INSERT INTO system_feedback (id, session_id, created_at, source, kind,"
            " target_id, text, active) VALUES (?,?,?,?,?,?,?,1)",
            (fid, sid, datetime.now(UTC).isoformat(), "human", kind, target, text))
        if kind == "pin" and target:
            conn.execute("UPDATE hypotheses SET state='pinned' WHERE id=?", (target,))
        elif kind == "rejection" and target:
            conn.execute("UPDATE hypotheses SET state='rejected' WHERE id=?", (target,))
        conn.execute(
            "INSERT INTO events (ts, session_id, agent, event, payload) VALUES (?,?,?,?,?)",
            (int(time.time() * 1000), sid, "human", "human_feedback",
             json.dumps({"kind": kind, "target_id": target, "text": text[:200]})))
        conn.commit()
        return _json(self, {"ok": True, "feedback_id": fid})

    def _set_hyp_state(self, conn, sid, hid):
        b = self._body_json()
        state = b.get("state")
        if state not in ("pinned", "rejected", "in_tournament", "retired"):
            return self._json_err(400, "bad state")
        conn.execute("UPDATE hypotheses SET state=? WHERE id=? AND session_id=?",
                     (state, hid, sid))
        conn.execute(
            "INSERT INTO events (ts, session_id, agent, event, payload) VALUES (?,?,?,?,?)",
            (int(time.time() * 1000), sid, "human", "hypothesis_state_changed",
             json.dumps({"hypothesis_id": hid, "state": state})))
        conn.commit()
        return _json(self, {"ok": True})

    # ---- static SPA ----
    def _serve_static(self, path):
        if not DIST.exists():
            self.send_response(200)
            self.send_header("Content-Type", "text/html")
            self.end_headers()
            self.wfile.write(b"<h1>Frontend not built</h1><p>Run <code>npm run build</code> in frontend/.</p>")
            return
        rel = path.lstrip("/") or "index.html"
        target = (DIST / rel).resolve()
        try:
            target.relative_to(DIST.resolve())
        except ValueError:
            target = DIST / "index.html"
        if not target.is_file():
            target = DIST / "index.html"  # SPA fallback
        data = target.read_bytes()
        ctype = mimetypes.guess_type(str(target))[0] or "application/octet-stream"
        self.send_response(200)
        self.send_header("Content-Type", ctype)
        self.send_header("Content-Length", str(len(data)))
        cache = "no-store" if target.name == "index.html" else "public, max-age=3600"
        self.send_header("Cache-Control", cache)
        self.end_headers()
        self.wfile.write(data)


def main():
    global DB_PATH
    ap = argparse.ArgumentParser()
    ap.add_argument("--port", type=int, default=8000)
    ap.add_argument("--host", default="127.0.0.1")
    ap.add_argument("--db", default=str(DEFAULT_DB))
    ap.add_argument("--seed", action="store_true", help="seed demo data on startup")
    args = ap.parse_args()
    DB_PATH = Path(args.db)
    if args.seed:
        from .seed import seed
        seed(DB_PATH, reset=True)
        print("seeded demo data")
    httpd = ThreadingHTTPServer((args.host, args.port), Handler)
    print(f"Co-Scientist web on http://{args.host}:{args.port}  (db={DB_PATH})")
    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        httpd.shutdown()


if __name__ == "__main__":
    main()
