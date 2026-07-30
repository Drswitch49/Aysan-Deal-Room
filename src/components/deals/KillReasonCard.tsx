/**
 * Kill Reason — shown on every killed deal, in both the deal detail overview and
 * the Deal Inbox detail modal.
 *
 * Always rendered for a killed deal (never hidden when the reason is blank):
 * deals killed before the reason was captured, or by the ETL backfill, show an
 * empty state with a way to record one after the fact.
 */
import { useState } from "react";
import { XCircle } from "lucide-react";
import { textareaClass } from "../ui/FormField";
import { cx } from "../../utils/cx";

export function KillReasonCard({
  reason,
  killedBy,
  killDate,
  onSave,
  className,
}: {
  reason: string;
  killedBy?: string;
  killDate?: string;
  /** Omit to render read-only. */
  onSave?: (reason: string) => Promise<void>;
  className?: string;
}) {
  const [isEditing, setIsEditing] = useState(false);
  const [draft, setDraft] = useState(reason);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const open = () => {
    setDraft(reason);
    setError(null);
    setIsEditing(true);
  };

  const save = async () => {
    if (!onSave) return;
    const next = draft.trim();
    if (!next) {
      setError("Enter a reason, or cancel.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave(next);
      setIsEditing(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save the kill reason.");
    } finally {
      setIsSaving(false);
    }
  };

  const formattedDate = (() => {
    if (!killDate) return "";
    const d = new Date(killDate);
    return isNaN(d.getTime()) ? String(killDate) : d.toLocaleDateString("en-GB");
  })();

  return (
    <div className={cx("rounded-2xl border border-rose-500/20 bg-rose-500/[0.04] p-5 space-y-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <XCircle className="h-3.5 w-3.5 text-rose-400 shrink-0" aria-hidden="true" />
          <span className="text-[9px] font-black uppercase tracking-widest text-rose-400 select-none font-sans">
            Kill Reason
          </span>
        </div>
        {onSave && !isEditing && (
          <button
            type="button"
            onClick={open}
            className="text-[9px] font-bold uppercase tracking-wider text-slate-400 hover:text-white transition cursor-pointer shrink-0"
          >
            {reason ? "Edit" : "Add"}
          </button>
        )}
      </div>

      {isEditing ? (
        <div className="space-y-2">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={3}
            autoFocus
            placeholder="Why was this deal killed?"
            className={textareaClass}
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setIsEditing(false)}
              className="h-8 px-3 rounded-lg border border-white/[0.06] text-[10px] font-bold uppercase tracking-wider text-slate-400 hover:text-white transition cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={save}
              disabled={isSaving}
              className="h-8 px-3 rounded-lg border border-rose-500/30 bg-rose-500/15 text-[10px] font-bold uppercase tracking-wider text-rose-300 hover:bg-rose-500/25 disabled:opacity-40 disabled:pointer-events-none transition cursor-pointer"
            >
              {isSaving ? "Saving..." : "Save"}
            </button>
          </div>
        </div>
      ) : (
        <p
          className={cx(
            "text-xs leading-relaxed whitespace-pre-wrap break-words",
            reason ? "font-medium text-slate-200" : "italic text-slate-500",
          )}
        >
          {reason || "No reason recorded for this kill."}
        </p>
      )}

      {error && <p className="text-[10px] font-semibold text-rose-400">{error}</p>}

      {(killedBy || formattedDate) && (
        <div className="pt-2 border-t border-rose-500/10 text-[10px] font-medium text-slate-500 space-y-0.5">
          {killedBy && (
            <div>
              Killed by <span className="text-slate-300">{killedBy}</span>
            </div>
          )}
          {formattedDate && (
            <div>
              On <span className="text-slate-300">{formattedDate}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
