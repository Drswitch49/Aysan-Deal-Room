import { useState, useEffect } from "react";
import { Loader2, Plus, Edit2, Trash2, Check, X } from "lucide-react";
import { cx } from "../../utils/cx";
import { api, type Paginated } from "../../api/http";

type NoteRow = Record<string, any>;

async function resolveNotesDealId(refOrId: string): Promise<string | null> {
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(refOrId)) return refOrId;
  const page = await api.get<Paginated<NoteRow>>(`/api/deals?ref=${encodeURIComponent(refOrId)}`);
  return page.rows[0]?.id ?? null;
}

interface Note {
  id: string;
  dealRef: string;
  author: string;
  content: string;
  createdAt: string;
  updatedAt: string;
}

interface ManualNotesTabProps {
  dealRef: string;
}

export function ManualNotesTab({ dealRef }: ManualNotesTabProps) {
  const [notes, setNotes] = useState<Note[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isAdding, setIsAdding] = useState(false);
  const [newContent, setNewContent] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit states
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editContent, setEditContent] = useState("");

  const fetchNotes = async () => {
    setIsLoading(true);
    try {
      const dealId = await resolveNotesDealId(dealRef);
      if (!dealId) { setNotes([]); return; }
      const page = await api.get<Paginated<NoteRow>>(`/api/deal-notes?deal_id=${encodeURIComponent(dealId)}&limit=200`);
      const mapped: Note[] = page.rows.map((r) => ({
        id: r.id,
        dealRef: r.deal_id ?? dealRef,
        author: r.author ?? r.author_email ?? "Team",
        content: r.note_content ?? "",
        createdAt: r.created_at ?? "",
        updatedAt: r.updated_at ?? r.created_at ?? "",
      }));
      setNotes(mapped.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()));
    } catch (err) {
      console.error("Failed to fetch notes:", err);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (dealRef) fetchNotes();
  }, [dealRef]);

  const handleAdd = async () => {
    if (!newContent.trim()) return;
    setIsSubmitting(true);
    try {
      const dealId = await resolveNotesDealId(dealRef);
      if (!dealId) throw new Error(`Deal not found: ${dealRef}`);
      await api.post("/api/deal-notes", { deal_id: dealId, note_content: newContent, legacy_deal_ref: dealRef });
      setNewContent("");
      setIsAdding(false);
      fetchNotes();
    } catch (error: any) {
      console.error(error);
      alert(error?.message || "Error adding note");
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleEditSubmit = async (id: string) => {
    if (!editContent.trim()) return;
    try {
      await api.patch(`/api/deal-notes/${encodeURIComponent(id)}`, { note_content: editContent });
      setEditingId(null);
      fetchNotes();
    } catch (error: any) {
      console.error(error);
      alert(error?.message || "Error updating note");
    }
  };

  const handleDelete = async (id: string) => {
    if (!window.confirm("Are you sure you want to delete this note?")) return;
    try {
      await api.del(`/api/deal-notes/${encodeURIComponent(id)}`);
      fetchNotes();
    } catch (error: any) {
      console.error(error);
      alert(error?.message || "Error deleting note");
    }
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <div className="flex items-center justify-between bg-[#161B22] p-4 rounded-xl border border-white/5">
        <div>
          <h3 className="text-sm font-semibold text-white tracking-wide">Working CRM Notes</h3>
          <p className="text-xs text-slate-400 mt-1">
            Private notes scoped to this deal. Visible to internal team members.
          </p>
        </div>
        <button
          onClick={() => setIsAdding(!isAdding)}
          className="flex items-center gap-2 bg-[#C6A66B]/10 hover:bg-[#C6A66B]/20 text-[#C6A66B] border border-[#C6A66B]/30 px-4 py-2 rounded-lg text-xs font-semibold transition-colors"
        >
          {isAdding ? <X className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
          {isAdding ? "Cancel" : "Add Note"}
        </button>
      </div>

      {isAdding && (
        <div className="bg-[#161B22] p-4 rounded-xl border border-white/5 space-y-3">
          <textarea
            value={newContent}
            onChange={(e) => setNewContent(e.target.value)}
            placeholder="Write your note here... (Supports multiple lines)"
            className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm text-slate-300 placeholder-slate-600 focus:outline-none focus:border-[#C6A66B]/50 min-h-[120px]"
          />
          <div className="flex justify-end">
            <button
              onClick={handleAdd}
              disabled={isSubmitting || !newContent.trim()}
              className="flex items-center gap-2 bg-[#C6A66B] hover:bg-[#B5955A] disabled:opacity-50 disabled:cursor-not-allowed text-black px-4 py-2 rounded-lg text-xs font-bold transition-all"
            >
              {isSubmitting && <Loader2 className="h-4 w-4 animate-spin" />}
              Save Note
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 text-[#C6A66B] animate-spin" />
        </div>
      ) : notes.length === 0 ? (
        <div className="text-center py-12 bg-[#161B22] rounded-xl border border-white/5">
          <p className="text-slate-500 text-sm">No notes recorded for this deal yet.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {notes.map((note) => (
            <div key={note.id} className="bg-[#161B22] p-5 rounded-xl border border-white/5 relative group">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-full bg-slate-800 flex items-center justify-center text-xs font-bold text-slate-300 uppercase border border-white/10">
                    {note.author?.slice(0, 2) || "??"}
                  </div>
                  <div>
                    <div className="text-sm font-medium text-slate-200">{note.author}</div>
                    <div className="text-[10px] text-slate-500 font-mono tracking-wider">
                      {new Date(note.createdAt).toLocaleString(undefined, {
                        year: 'numeric', month: 'short', day: 'numeric',
                        hour: '2-digit', minute: '2-digit'
                      })}
                      {note.updatedAt && note.updatedAt !== note.createdAt && " (edited)"}
                    </div>
                  </div>
                </div>
                <div className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-2">
                  <button
                    onClick={() => {
                      setEditingId(note.id);
                      setEditContent(note.content);
                    }}
                    className="p-1.5 text-slate-400 hover:text-white bg-white/5 hover:bg-white/10 rounded-md transition-colors"
                    title="Edit"
                  >
                    <Edit2 className="h-3.5 w-3.5" />
                  </button>
                  <button
                    onClick={() => handleDelete(note.id)}
                    className="p-1.5 text-slate-400 hover:text-red-400 bg-white/5 hover:bg-red-500/10 rounded-md transition-colors"
                    title="Delete"
                  >
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              {editingId === note.id ? (
                <div className="space-y-3 mt-3">
                  <textarea
                    value={editContent}
                    onChange={(e) => setEditContent(e.target.value)}
                    className="w-full bg-black/40 border border-white/10 rounded-lg p-3 text-sm text-slate-300 focus:outline-none focus:border-[#C6A66B]/50 min-h-[100px]"
                  />
                  <div className="flex justify-end gap-2">
                    <button
                      onClick={() => setEditingId(null)}
                      className="px-3 py-1.5 text-xs font-semibold text-slate-400 hover:text-white transition-colors"
                    >
                      Cancel
                    </button>
                    <button
                      onClick={() => handleEditSubmit(note.id)}
                      className="flex items-center gap-1.5 bg-[#C6A66B]/20 text-[#C6A66B] border border-[#C6A66B]/30 px-3 py-1.5 rounded-md text-xs font-bold transition-colors hover:bg-[#C6A66B]/30"
                    >
                      <Check className="h-3.5 w-3.5" />
                      Save
                    </button>
                  </div>
                </div>
              ) : (
                <div className="text-sm text-slate-300 whitespace-pre-wrap leading-relaxed mt-2 pl-[44px]">
                  {note.content}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
