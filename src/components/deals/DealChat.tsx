import { useState, useEffect, useRef } from "react";
import { Send, AlertCircle, MessageSquare, Loader2, RefreshCw, Database } from "lucide-react";
import {
  fetchLenderChat,
  sendLenderChatMessage,
  fetchAdminChat,
  sendAdminChatMessage,
  subscribeDealChat
} from "../../api/chat";
import type { ChatMessage } from "../../types/deal";
import { formatDate } from "../../utils/fields";

interface DealChatProps {
  mode: "lender" | "admin";
  dealId: string;
  lenderRecordId?: string; // Required in admin mode
  portalSlug?: string; // Required in lender mode
  lenderName?: string; // Optional display name for header / references
}

export function DealChat({
  mode,
  dealId,
  lenderRecordId,
  portalSlug,
  lenderName
}: DealChatProps) {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isTableMissing, setIsTableMissing] = useState(false);
  const [inputText, setInputText] = useState("");

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const maxChars = 1000;

  // Fetch messages from backend
  const loadChat = async () => {
    if (!dealId) return;
    setError(null);
    setIsTableMissing(false);

    try {
      let data: ChatMessage[] = [];
      if (mode === "lender") {
        if (!portalSlug) throw new Error("Portal slug is required in lender mode");
        data = await fetchLenderChat(portalSlug, dealId);
      } else {
        if (!lenderRecordId) throw new Error("Lender record ID is required in admin mode");
        data = await fetchAdminChat(dealId, lenderRecordId);
      }
      setMessages(data);
    } catch (err: any) {
      console.error("Error loading chat messages:", err);
      if (
        err.message?.includes("TABLE_NOT_FOUND") || 
        err.message?.includes("Chat table not setup") ||
        err.message?.includes("not found")
      ) {
        setIsTableMissing(true);
      } else {
        setError(err.message || "Failed to load chat history. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  // Initial history load (one shot — new messages arrive via realtime below).
  useEffect(() => {
    setLoading(true);
    loadChat();
  }, [dealId, lenderRecordId, portalSlug, mode]);

  // Subscribe to new messages over Supabase Realtime (replaces polling).
  useEffect(() => {
    if (!dealId) return;
    const unsubscribe = subscribeDealChat(dealId, {
      lenderId: mode === "admin" ? lenderRecordId : undefined,
      onInsert: (msg) =>
        setMessages((prev) => (prev.some((m) => m.id === msg.id) ? prev : [...prev, msg])),
    });
    return unsubscribe;
  }, [dealId, lenderRecordId, portalSlug, mode]);

  // Scroll to bottom when messages update
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  // Update last read state in local storage when messages are viewed or sent
  useEffect(() => {
    if (messages.length === 0) return;
    if (mode === "admin" && lenderRecordId) {
      const nowStr = new Date().toISOString();
      localStorage.setItem(`admin_last_read_${lenderRecordId}`, nowStr);
      localStorage.setItem(`admin_last_read_${lenderRecordId}_${dealId}`, nowStr);
    } else if (mode === "lender" && dealId) {
      localStorage.setItem(`lender_last_read_${dealId}`, new Date().toISOString());
    }
  }, [messages, mode, lenderRecordId, dealId]);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inputText.trim() || submitting || inputText.length > maxChars) return;

    setSubmitting(true);
    setError(null);
    const contentToSend = inputText.trim();

    try {
      let newMessage: ChatMessage;
      if (mode === "lender") {
        if (!portalSlug) throw new Error("Portal slug is required");
        newMessage = await sendLenderChatMessage(portalSlug, dealId, contentToSend);
      } else {
        if (!lenderRecordId) throw new Error("Lender record ID is required");
        newMessage = await sendAdminChatMessage(dealId, lenderRecordId, contentToSend);
      }

      setMessages((prev) => [...prev, newMessage]);
      setInputText("");
    } catch (err: any) {
      console.error("Error sending message:", err);
      setError(err.message || "Failed to send message. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  // Helper to determine if a message was sent by the active viewer (self)
  const isSelf = (message: ChatMessage) => {
    if (mode === "admin") {
      return message.sender === "Admin";
    } else {
      return message.sender !== "Admin";
    }
  };

  if (isTableMissing) {
    if (mode === "lender") {
      return (
        <div className="rounded-2xl border border-white/5 bg-acp-card p-6 md:p-8 backdrop-blur-md shadow-premium-card text-left max-w-2xl mx-auto my-6 animate-fade-in-up">
          <div className="flex items-center gap-3 text-acp-bronze mb-4">
            <MessageSquare className="h-6 w-6 shrink-0" />
            <h3 className="text-lg font-semibold tracking-wide font-display text-white">
              Secure Chat Offline
            </h3>
          </div>
          <p className="text-sm text-slate-305 mb-6 leading-relaxed">
            The secure communication channel for this transaction room is temporarily offline or undergoing scheduled maintenance. Please reach out to your Aysan Capital Partners representative directly via email or phone for immediate coordination.
          </p>
          <div className="mt-8 flex justify-end">
            <button
              onClick={() => {
                setLoading(true);
                loadChat();
              }}
              className="flex items-center gap-2 rounded-xl bg-white/[0.015] border border-white/[0.02] px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-white/[0.02] hover:border-acp-bronze"
            >
              <RefreshCw className="h-3 w-3" />
              Retry Connection
            </button>
          </div>
        </div>
      );
    }

    return (
      <div className="rounded-2xl border border-acp-bronze/20 bg-acp-card p-6 md:p-8 backdrop-blur-md shadow-premium-card text-left max-w-2xl mx-auto my-6 animate-fade-in-up">
        <div className="flex items-center gap-3 text-acp-bronze mb-4">
          <Database className="h-6 w-6 shrink-0" />
          <h3 className="text-lg font-semibold tracking-wide font-display text-white">
            Airtable Chat Setup Required
          </h3>
        </div>
        <p className="text-sm text-slate-300 mb-6 leading-relaxed">
          The deal-room chat function requires a new table named <code className="bg-white/[0.02] px-1.5 py-0.5 rounded text-acp-bronze font-mono">Chat_Messages</code> in your Airtable base to store conversation histories securely.
        </p>

        <div className="border-t border-white/5 pt-4">
          <h4 className="text-xs font-extrabold uppercase tracking-widest text-slate-400 mb-3">
            Table Structure Guidelines:
          </h4>
          <ol className="space-y-3.5 text-xs text-slate-300">
            <li className="flex gap-2">
              <span className="text-acp-bronze font-bold">1.</span>
              <span><strong>Table Name:</strong> <code className="bg-white/[0.015] px-1 rounded text-white font-mono">Chat_Messages</code></span>
            </li>
            <li className="flex gap-2">
              <span className="text-acp-bronze font-bold">2.</span>
              <div>
                <strong>Add Columns:</strong>
                <ul className="mt-2 space-y-2 pl-4 list-disc text-slate-400">
                  <li><code className="text-white font-mono">Message</code> &mdash; Type: <strong>Long text</strong></li>
                  <li><code className="text-white font-mono">Sender</code> &mdash; Type: <strong>Single line text</strong></li>
                  <li><code className="text-white font-mono">Deal_Ref</code> &mdash; Type: <strong>Link to Active_Pipeline</strong></li>
                  <li><code className="text-white font-mono">Lender_ID</code> &mdash; Type: <strong>Link to Lenders</strong></li>
                  <li><code className="text-white font-mono">Timestamp</code> &mdash; Type: <strong>Created Time</strong></li>
                </ul>
              </div>
            </li>
          </ol>
        </div>

        <div className="mt-8 flex justify-end">
          <button
            onClick={() => {
              setLoading(true);
              loadChat();
            }}
            className="flex items-center gap-2 rounded-xl bg-white/[0.015] border border-white/[0.02] px-4 py-2 text-xs font-semibold text-white transition-all hover:bg-white/[0.02] hover:border-acp-bronze"
          >
            <RefreshCw className="h-3 w-3" />
            Check Connection
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[550px] w-full rounded-2xl border border-white/[0.02] bg-acp-card backdrop-blur-md shadow-premium-card overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-white/5 px-6 py-4 bg-white/[0.01]">
        <div className="flex items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-acp-bronze/10 text-acp-bronze border border-acp-bronze/20">
            <MessageSquare className="h-4 w-4" />
          </div>
          <div>
            <h3 className="text-sm font-semibold text-white tracking-wide">
              {mode === "admin" ? `Chat with ${lenderName || "Lender"}` : "Private Room Chat"}
            </h3>
            <p className="text-[10px] text-slate-400 tracking-wider uppercase mt-0.5">
              Secure Lender-Admin Line
            </p>
          </div>
        </div>
        <button
          onClick={loadChat}
          disabled={loading}
          className="text-slate-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-white/[0.015] disabled:opacity-40"
          title="Refresh messages"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>

      {/* Messages Window */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4 min-h-0 bg-white/[0.005]">
        {loading && messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full space-y-3">
            <Loader2 className="h-6 w-6 animate-spin text-acp-bronze" />
            <p className="text-xs text-slate-400">Loading chat history...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-center p-6">
            <div className="rounded-full bg-white/[0.015] p-4 border border-white/5 text-slate-400 mb-3">
              <MessageSquare className="h-6 w-6" />
            </div>
            <h4 className="text-sm font-medium text-slate-200">No Messages Yet</h4>
            <p className="text-xs text-slate-400 mt-1 max-w-xs leading-relaxed">
              Initiate communication by typing a message in the input box below.
            </p>
          </div>
        ) : (
          messages.map((msg) => {
            const currentSenderIsSelf = isSelf(msg);
            return (
              <div
                key={msg.id}
                className={`flex flex-col ${
                  currentSenderIsSelf ? "items-end" : "items-start"
                }`}
              >
                {/* Bubble Meta */}
                <span className="text-[10px] text-slate-400 font-medium px-1 mb-1 select-none">
                  {currentSenderIsSelf ? "You" : msg.sender} &bull; {formatDate(msg.timestamp)}
                </span>
                
                {/* Bubble Body */}
                <div
                  className={`px-4 py-2.5 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap max-w-[80%] ${
                    currentSenderIsSelf
                      ? "bg-acp-bronze text-white rounded-tr-none shadow-glow-bronze/10"
                      : "bg-white/[0.015] border border-white/[0.02] text-slate-100 rounded-tl-none"
                  }`}
                >
                  {msg.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input box form */}
      <form
        onSubmit={handleSendMessage}
        className="border-t border-white/5 px-6 py-4 bg-white/[0.01]"
      >
        {error && (
          <div className="flex items-center gap-2 text-xs text-red-400 bg-red-950/20 border border-red-500/10 rounded-xl px-4 py-2 mb-3">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            <span>{error}</span>
          </div>
        )}

        <div className="flex items-end gap-3">
          <div className="relative flex-1">
            <textarea
              value={inputText}
              onChange={(e) => setInputText(e.target.value)}
              placeholder="Type your message here..."
              disabled={submitting}
              rows={2}
              className="w-full rounded-xl bg-white/[0.015] border border-white/[0.02] px-4 py-2.5 pr-14 text-sm text-white placeholder-slate-400 focus:border-acp-bronze focus:outline-none focus:ring-1 focus:ring-acp-bronze resize-none transition-all disabled:opacity-50"
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendMessage(e);
                }
              }}
            />
            {inputText.length > 0 && (
              <span
                className={`absolute right-3 bottom-2 text-[10px] select-none ${
                  inputText.length > maxChars ? "text-red-400" : "text-slate-400"
                }`}
              >
                {inputText.length} / {maxChars}
              </span>
            )}
          </div>
          
          <button
            type="submit"
            disabled={!inputText.trim() || submitting || inputText.length > maxChars}
            className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-acp-bronze text-white transition-all hover:bg-acp-bronze-dark disabled:bg-white/[0.015] disabled:text-slate-500 disabled:cursor-not-allowed hover:shadow-glow-bronze"
            title="Send message"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Send className="h-4 w-4" />
            )}
          </button>
        </div>
      </form>
    </div>
  );
}
