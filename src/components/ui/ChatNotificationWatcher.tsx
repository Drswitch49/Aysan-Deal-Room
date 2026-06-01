import { useState, useEffect, useRef } from "react";
import { MessageSquare, X } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { fetchRecentAdminChat, fetchRecentLenderChat } from "../../api/chat";
import { getDeals } from "../../api/airtable";
import { fetchAdminLenders } from "../../api/admin";
import type { PipelineDeal, ChatMessage } from "../../types/deal";

type ToastNotification = {
  id: string;
  senderName: string;
  dealContext: string;
  messageText: string;
  onClick: () => void;
};

interface ChatNotificationWatcherProps {
  mode: "admin" | "lender";
  portalSlug?: string;
  deals?: PipelineDeal[];
}

export function ChatNotificationWatcher({ mode, portalSlug, deals: lenderDeals }: ChatNotificationWatcherProps) {
  const navigate = useNavigate();
  const [toasts, setToasts] = useState<ToastNotification[]>([]);
  
  // Cache lists for mapping Record IDs to names/references
  const [adminDeals, setAdminDeals] = useState<PipelineDeal[]>([]);
  const [adminLenders, setAdminLenders] = useState<any[]>([]);

  const seenMessageIds = useRef<Set<string>>(new Set());
  const isFirstFetch = useRef<boolean>(true);

  // Fetch admin metadata mapping cache on mount
  useEffect(() => {
    if (mode === "admin") {
      getDeals().then(setAdminDeals).catch(err => console.error("Watcher failed to cache deals:", err));
      fetchAdminLenders().then(setAdminLenders).catch(err => console.error("Watcher failed to cache lenders:", err));
    }
  }, [mode]);

  // Main polling effect
  useEffect(() => {
    // If lender mode, only start polling once authenticated and portalSlug is available
    if (mode === "lender" && !portalSlug) return;

    const pollInterval = setInterval(async () => {
      try {
        let messages: ChatMessage[] = [];
        if (mode === "admin") {
          messages = await fetchRecentAdminChat();
        } else if (mode === "lender" && portalSlug) {
          messages = await fetchRecentLenderChat(portalSlug);
        }

        if (!messages || messages.length === 0) return;

        // On first run, just populate the seen list without triggering toasts for historic messages
        if (isFirstFetch.current) {
          messages.forEach((msg: any) => seenMessageIds.current.add(msg.id));
          isFirstFetch.current = false;
          return;
        }

        // Check for new messages
        const newMessages = messages.filter((msg: any) => !seenMessageIds.current.has(msg.id));
        if (newMessages.length === 0) return;

        newMessages.forEach((msg: any) => {
          seenMessageIds.current.add(msg.id);

          // We only notify when the message is from the other party
          const shouldNotify = 
            (mode === "admin" && msg.sender === "Lender") ||
            (mode === "lender" && msg.sender === "Admin");

          if (shouldNotify) {
            triggerToast(msg);
          }
        });
      } catch (err) {
        console.error("Failed to poll chat messages in watcher:", err);
      }
    }, 8000);

    // Initial run immediately
    const runInitial = async () => {
      try {
        let messages: ChatMessage[] = [];
        if (mode === "admin") {
          messages = await fetchRecentAdminChat();
        } else if (mode === "lender" && portalSlug) {
          messages = await fetchRecentLenderChat(portalSlug);
        }
        if (messages && messages.length > 0) {
          messages.forEach((msg: any) => seenMessageIds.current.add(msg.id));
        }
        isFirstFetch.current = false;
      } catch (err) {
        console.error("Watcher initial chat fetch failed:", err);
      }
    };
    runInitial();

    return () => clearInterval(pollInterval);
  }, [mode, portalSlug, adminDeals, adminLenders, lenderDeals]);

  const triggerToast = (msg: any) => {
    let senderName = "New Message";
    let dealContext = "";
    let onClick = () => {};

    if (mode === "admin") {
      // Find lender details
      const lender = adminLenders.find(l => l.id === msg.lenderId);
      senderName = lender ? lender.Company_Name : "Lender";

      // Find deal details
      const deal = adminDeals.find(d => d.id === msg.dealId);
      const dealRef = deal ? deal.dealRef : "";
      const dealCompany = deal ? deal.companyName : "Assigned Deal";
      dealContext = dealRef ? `${dealCompany} (REF: ${dealRef})` : dealCompany;

      onClick = () => {
        if (dealRef) {
          navigate(`/deals/${encodeURIComponent(dealRef)}?tab=chat&lenderId=${msg.lenderId}`);
        }
      };
    } else {
      senderName = "ACP Deal Manager";
      
      // Find deal details from props
      const dealsList = lenderDeals || [];
      const deal = dealsList.find(d => d.id === msg.dealId);
      const dealCompany = deal ? deal.companyName : "Your Deal Room";
      dealContext = dealCompany;

      onClick = () => {
        navigate(`/portal/${portalSlug}?dealId=${msg.dealId}&tab=chat`);
      };
    }

    const toastId = Math.random().toString(36).substring(2, 9);
    const newToast: ToastNotification = {
      id: toastId,
      senderName,
      dealContext,
      messageText: msg.message,
      onClick
    };

    setToasts(prev => [...prev, newToast]);

    // Auto dismiss after 6 seconds
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== toastId));
    }, 6000);
  };

  const dismissToast = (id: string, e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent trigger click
    setToasts(prev => prev.filter(t => t.id !== id));
  };

  if (toasts.length === 0) return null;

  return (
    <>
      <style>{`
        @keyframes toastSlideIn {
          from {
            transform: translateX(120%) scale(0.9);
            opacity: 0;
          }
          to {
            transform: translateX(0) scale(1);
            opacity: 1;
          }
        }
        .animate-toast-slide-in {
          animation: toastSlideIn 0.35s cubic-bezier(0.16, 1, 0.3, 1) forwards;
        }
      `}</style>
      <div className="fixed top-6 right-6 z-[9999] flex flex-col gap-3.5 max-w-sm w-full pointer-events-none">
        {toasts.map(toast => (
          <div
            key={toast.id}
            onClick={toast.onClick}
            className="pointer-events-auto w-full rounded-2xl border border-white/10 bg-slate-950/80 backdrop-blur-xl p-4 shadow-[0_12px_40px_rgba(0,0,0,0.5)] flex items-start gap-3.5 transform transition-all duration-300 hover:border-acp-bronze/45 hover:bg-slate-900/90 cursor-pointer animate-toast-slide-in relative group card-sheen"
          >
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-acp-bronze/10 border border-acp-bronze/20 text-acp-bronze transition-transform duration-300 group-hover:scale-105">
              <MessageSquare className="h-4.5 w-4.5" />
            </div>

            <div className="min-w-0 pr-6">
              <h4 className="text-xs font-bold text-white tracking-wide">
                {toast.senderName}
              </h4>
              <p className="text-[10px] text-acp-bronze font-bold uppercase tracking-wider mt-0.5">
                {toast.dealContext}
              </p>
              <p className="text-[11px] text-slate-350 truncate mt-1 leading-normal italic">
                "{toast.messageText}"
              </p>
            </div>

            <button
              onClick={(e) => dismissToast(toast.id, e)}
              className="absolute top-3.5 right-3.5 h-5 w-5 flex items-center justify-center rounded bg-white/5 border border-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition cursor-pointer"
              title="Dismiss notification"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
