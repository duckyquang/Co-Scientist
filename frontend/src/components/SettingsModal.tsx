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
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4 animate-fade-in">
      <div className="card max-w-lg w-full p-6 animate-fade-up">
        <div className="flex items-center justify-between">
          <h2 className="font-serif text-lg font-semibold text-ink">Settings</h2>
          <button onClick={onClose} className="text-ink-soft hover:text-ink"><X className="h-5 w-5" /></button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <label className="label">How should sessions run?</label>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {OPTIONS.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  onClick={() => setMode(id)}
                  className={`flex items-center justify-center gap-2 border px-3 py-2.5 text-sm transition-colors ${
                    mode === id
                      ? "border-blue bg-blue-soft text-ink"
                      : "border-rule text-ink-soft hover:text-ink"
                  }`}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
          </div>

          {mode === "default" ? (
            <div className="border border-rule bg-card p-4 text-sm text-ink-soft">
              Runs free — in your browser (or on our server) with no key and no
              account needed.
              <a
                href={README_LOCAL_URL}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 block text-xs font-medium text-blue underline underline-offset-2 hover:text-accent"
              >
                Self-hosting? Run <code className="font-mono text-blue">co-scientist serve</code> with your .env keys →
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
                <p className="mt-2 text-xs text-ink-soft">
                  Stored in your browser only. Sent with each request to run sessions with your account.
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
