import { useEffect, useState } from "react";
import { Sparkles, KeyRound, X, Check } from "lucide-react";
import { README_LOCAL_URL } from "../lib/config";
import {
  clearCredentials, DeploymentMode, getCredentials, getDeploymentMode,
  setCredentials, setDeploymentMode,
} from "../lib/credentials";

// Groq first — it's the only provider that runs directly in the browser.
const PROVIDERS = [
  { id: "groq", label: "Groq (runs in your browser)" },
  { id: "anthropic", label: "Anthropic" },
  { id: "openai", label: "OpenAI" },
  { id: "openrouter", label: "OpenRouter" },
  { id: "gemini", label: "Google Gemini" },
  { id: "ollama", label: "Ollama (local)" },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

export function SettingsModal({ open, onClose }: Props) {
  const [mode, setMode] = useState<DeploymentMode>("default");
  const [provider, setProvider] = useState("groq");
  const [apiKey, setApiKey] = useState("");
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (!open) return;
    setMode(getDeploymentMode());
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
    if (mode === "byok" && apiKey.trim()) {
      setCredentials({ provider, apiKey: apiKey.trim() });
    } else {
      // Free mode, or BYOK with the key blanked → actually remove the stored key.
      clearCredentials();
    }
    setSaved(true);
    setTimeout(onClose, 600);
  }

  const OPTIONS: { id: DeploymentMode; label: string; icon: typeof Sparkles }[] = [
    { id: "default", label: "Free", icon: Sparkles },
    { id: "byok", label: "Your own API key", icon: KeyRound },
  ];

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="card max-w-lg w-full p-6 animate-fade-up">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-bold text-fg">Settings</h2>
          <button onClick={onClose} className="text-faint hover:text-fg"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="label">How should sessions run?</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {OPTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2.5 text-sm font-medium transition ${
                    mode === id
                      ? "border-brand-400/50 bg-brand-500/15 text-fg"
                      : "border-line text-muted hover:text-fg"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "default" ? (
            <div className="rounded-xl border border-line bg-surface-2 p-4 text-sm text-muted">
              Runs free — in your browser (or on our server) with no key and no
              account needed.
              <a
                href={README_LOCAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block text-xs font-medium text-brand-500 hover:text-brand-400"
              >
                Self-hosting? Run <code className="text-brand-500">co-scientist serve</code> with your .env keys →
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
                  placeholder={provider === "groq" ? "gsk_…" : "sk-…"}
                  className="input mt-1.5 w-full font-mono text-sm"
                />
                <p className="mt-2 text-xs text-faint">
                  Stored in your browser only.{" "}
                  {provider === "groq"
                    ? "Your Groq key runs sessions directly in your browser."
                    : "Non-Groq keys only work when a hosted backend is configured — browsers can't call this provider directly."}
                </p>
              </div>
            </>
          )}
        </div>

        <div className="mt-6 flex justify-end gap-2">
          <button onClick={onClose} className="btn-ghost">Cancel</button>
          <button onClick={save} className="btn-primary">
            {saved ? (
              <span className="inline-flex items-center gap-1.5"><Check className="h-4 w-4" /> Saved</span>
            ) : (
              "Save"
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
