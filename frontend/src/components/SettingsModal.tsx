import { useEffect, useState } from "react";
import { README_LOCAL_URL } from "../lib/config";
import {
  clearCredentials, DeploymentMode, getCredentials, getDeploymentMode,
  setCredentials, setDeploymentMode,
} from "../lib/credentials";

const PROVIDERS = [
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Google Gemini" },
  { id: "groq", label: "Groq" },
  { id: "ollama", label: "Ollama (local)" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const [mode, setMode] = useState<DeploymentMode>("cloud");
  const [provider, setProvider] = useState("anthropic");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(getDeploymentMode() || "cloud");
    const creds = getCredentials();
    if (creds) {
      setProvider(creds.provider);
      setApiKey(creds.apiKey);
    }
    setSaved(false);
  }, [open]);

  if (!open) return null;

  function save() {
    setDeploymentMode(mode);
    if (mode === "cloud" && apiKey.trim()) {
      setCredentials({ provider, apiKey: apiKey.trim() });
    } else if (mode === "local") {
      clearCredentials();
    }
    setSaved(true);
    setTimeout(onClose, 600);
  }

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="card max-w-lg w-full p-6 animate-fade-up">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-white">Settings</h2>
          <button onClick={onClose} className="text-slate-500 hover:text-white">✕</button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="label">Deployment mode</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {(["local", "cloud"] as const).map((m) => (
                <button
                  key={m}
                  onClick={() => setMode(m)}
                  className={`rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                    mode === m
                      ? "border-brand-400/50 bg-brand-500/15 text-white"
                      : "border-white/10 text-slate-400 hover:text-white"
                  }`}
                >
                  {m === "local" ? "💻 Local" : "🌐 Cloud + API key"}
                </button>
              ))}
            </div>
          </div>

          {mode === "local" ? (
            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4 text-sm text-slate-400">
              Local mode uses keys from your <code className="text-brand-300">.env</code> file when you run{" "}
              <code className="text-brand-300">co-scientist serve</code> on your machine.
              <a
                href={README_LOCAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block font-semibold text-brand-300 hover:text-brand-200"
              >
                View local setup guide →
              </a>
            </div>
          ) : (
            <>
              <div>
                <label className="label">LLM provider</label>
                <select
                  value={provider}
                  onChange={(e) => setProvider(e.target.value)}
                  className="input mt-1.5 w-full"
                >
                  {PROVIDERS.map((p) => (
                    <option key={p.id} value={p.id}>{p.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">API key</label>
                <input
                  type="password"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="sk-…"
                  className="input mt-1.5 w-full font-mono text-sm"
                />
                <p className="mt-2 text-xs text-slate-500">
                  Stored in your browser only. Sent with each request to run sessions with your account.
                </p>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} className="btn-primary">
            {saved ? "Saved ✓" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
