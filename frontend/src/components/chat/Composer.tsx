import { useRef, useEffect } from "react";
import { ArrowUp, Loader2 } from "lucide-react";

/** Bottom-docked chat composer. Controlled by the parent so the same bar serves
 *  the landing (submit a goal) and a running thread (send steering). */
export function Composer({
  value, onChange, onSend, placeholder, sending, accessory, autoFocus,
}: {
  value: string;
  onChange: (v: string) => void;
  onSend: () => void;
  placeholder: string;
  sending?: boolean;
  accessory?: React.ReactNode;
  autoFocus?: boolean;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);

  // Auto-grow the textarea to its content, capped.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = "0px";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
  }, [value]);

  function onKeyDown(e: React.KeyboardEvent) {
    if ((e.nativeEvent as any).isComposing) return; // don't send on an IME commit-Enter
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (value.trim() && !sending) onSend();
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-surface p-2 shadow-card focus-within:border-brand-500/50 focus-within:ring-2 focus-within:ring-brand-500/12">
      {accessory && <div className="px-1.5 pt-1 pb-2">{accessory}</div>}
      <div className="flex items-end gap-2">
        <textarea
          ref={ref}
          value={value}
          autoFocus={autoFocus}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          rows={1}
          placeholder={placeholder}
          className="max-h-[200px] flex-1 resize-none bg-transparent px-2.5 py-2 text-[15px] leading-relaxed text-fg placeholder:text-faint outline-none"
        />
        <button
          onClick={() => value.trim() && !sending && onSend()}
          disabled={!value.trim() || sending}
          aria-label="Send"
          className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand-600 text-white transition hover:bg-brand-500 active:scale-95 disabled:opacity-30 disabled:pointer-events-none"
        >
          {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUp className="h-4 w-4" strokeWidth={2.5} />}
        </button>
      </div>
    </div>
  );
}
