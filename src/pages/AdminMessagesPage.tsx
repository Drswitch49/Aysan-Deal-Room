import { useState, useEffect, useMemo } from "react";
import { MessageSquare, Search, ChevronDown, ChevronRight, FolderDot } from "lucide-react";
import { useSearchParams } from "react-router-dom";
import { PageHeader } from "../components/ui/PageHeader";
import { LoadingState } from "../components/ui/LoadingState";
import { EmptyState } from "../components/ui/EmptyState";
import { DealChat } from "../components/deals/DealChat";
import { fetchAdminLenders } from "../api/admin";
import { getDeals } from "../api/airtable";
import { fetchRecentAdminChat } from "../api/chat";
import type { PipelineDeal, ChatMessage } from "../types/deal";
import { cx } from "../utils/cx";

type DealConversation = {
  dealId: string;
  dealRef: string;
  companyName: string;
  totalCount: number;
  unreadCount: number;
  latestMsg: ChatMessage;
};

type Conversation = {
  lender: any;
  totalCount: number;
  unreadCount: number;
  latestMsg: ChatMessage;
  deals: DealConversation[];
};

export function AdminMessagesPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [lenders, setLenders] = useState<any[]>([]);
  const [deals, setDeals] = useState<PipelineDeal[]>([]);
  const [recentMessages, setRecentMessages] = useState<ChatMessage[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [searchQuery, setSearchQuery] = useState("");

  // Select active conversation
  const activeLenderId = searchParams.get("lenderId") || "";
  const activeDealId = searchParams.get("dealId") || "";

  useEffect(() => {
    loadData();
  }, []);

  // Poll for new messages every 8 seconds to update counters in real-time
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const messages = await fetchRecentAdminChat();
        setRecentMessages(messages);
      } catch (err) {
        console.error("Admin messages page failed to poll recent chats:", err);
      }
    }, 8000);
    return () => clearInterval(interval);
  }, []);

  async function loadData() {
    setIsLoading(true);
    setError("");
    try {
      const [lendersList, allDeals, messages] = await Promise.all([
        fetchAdminLenders(),
        getDeals().catch(() => []),
        fetchRecentAdminChat().catch((err) => {
          console.error("Failed to fetch recent admin chat:", err);
          return [];
        })
      ]);
      setLenders(lendersList);
      setDeals(allDeals);
      setRecentMessages(messages);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load messages data.");
    } finally {
      setIsLoading(false);
    }
  }

  // Compute conversation list (one item per lender) sorted by latest activity
  const conversations = useMemo(() => {
    return lenders.map((lender) => {
      const msgs = recentMessages.filter((m) => m.lenderId === lender.id);
      if (msgs.length === 0) return null;

      // Group lender messages by dealId
      const msgsByDeal: Record<string, ChatMessage[]> = {};
      msgs.forEach((m) => {
        if (!msgsByDeal[m.dealId]) {
          msgsByDeal[m.dealId] = [];
        }
        msgsByDeal[m.dealId].push(m);
      });

      const dealConversations = Object.entries(msgsByDeal).map(([dealId, dealMsgs]) => {
        const sortedDealMsgs = [...dealMsgs].sort(
          (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
        );
        const latestDealMsg = sortedDealMsgs[0];

        // Find the deal info
        const dealInfo = deals.find((d) => d.id === dealId);
        const dealRef = dealInfo ? dealInfo.dealRef : "";
        const companyName = dealInfo ? dealInfo.companyName : "Assigned Deal";

        // Read status per deal-lender combo
        const lastReadTimeStr = localStorage.getItem(`admin_last_read_${lender.id}_${dealId}`) || 
                               localStorage.getItem(`admin_last_read_${lender.id}`);
        const lastReadTime = lastReadTimeStr ? new Date(lastReadTimeStr).getTime() : 0;
        
        const dealUnreadCount = sortedDealMsgs.filter(
          (m) => m.sender !== "Admin" && new Date(m.timestamp).getTime() > lastReadTime
        ).length;

        return {
          dealId,
          dealRef,
          companyName,
          totalCount: dealMsgs.length,
          unreadCount: dealUnreadCount,
          latestMsg: latestDealMsg,
        };
      }).sort((a, b) => new Date(b.latestMsg.timestamp).getTime() - new Date(a.latestMsg.timestamp).getTime());

      // Sort lender's overall messages to get the absolute newest message for the parent view
      const sortedMsgs = [...msgs].sort(
        (a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime()
      );
      const latestMsg = sortedMsgs[0];

      // Calculate unread count (sum of all deals)
      const totalUnreadCount = dealConversations.reduce((sum, d) => sum + d.unreadCount, 0);

      return {
        lender,
        totalCount: msgs.length,
        unreadCount: totalUnreadCount,
        latestMsg,
        deals: dealConversations,
      };
    })
    .filter((c): c is Conversation => c !== null)
    .sort((a, b) => {
      const timeA = new Date(a.latestMsg.timestamp).getTime();
      const timeB = new Date(b.latestMsg.timestamp).getTime();
      return timeB - timeA;
    });
  }, [lenders, recentMessages, deals]);

  // Filter conversations by search query (Lender name or Deal name)
  const filteredConversations = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const query = searchQuery.toLowerCase().trim();
    return conversations.filter((conv) => {
      const lenderName = String(conv.lender.Company_Name || "").toLowerCase();
      
      const matchesLender = lenderName.includes(query);
      const matchesDeal = conv.deals.some((d) => 
        String(d.companyName || "").toLowerCase().includes(query) ||
        String(d.dealRef || "").toLowerCase().includes(query)
      );

      return matchesLender || matchesDeal;
    });
  }, [conversations, searchQuery]);

  // Active selected conversation
  const selectedConversation = useMemo(() => {
    if (!activeLenderId) return null;
    return conversations.find((c) => c.lender.id === activeLenderId) || null;
  }, [conversations, activeLenderId]);

  const handleSelectLender = (conv: Conversation) => {
    if (activeLenderId === conv.lender.id) {
      // If clicking the already active lender, collapse it (clear selection params)
      setSearchParams({});
    } else {
      // If clicking a new lender, select their most recent active deal automatically
      const defaultDealId = conv.deals.length > 0 ? conv.deals[0].dealId : "";
      setSearchParams({
        lenderId: conv.lender.id,
        dealId: defaultDealId
      });
    }
  };

  const formatTime = (timestamp: string) => {
    if (!timestamp) return "";
    const date = new Date(timestamp);
    return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " +
      date.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="space-y-6 animate-fade-in-up">
      <PageHeader title="Lender Communications" eyebrow="Unified Inbox" />

      {isLoading ? <LoadingState /> : null}
      {error ? <EmptyState title="Communication Error" message={error} /> : null}

      {!isLoading && !error && (
        <div className="grid grid-cols-1 lg:grid-cols-[360px_1fr] gap-6 h-[calc(100vh-210px)] min-h-[550px] items-stretch">
          
          {/* Left Pane: Conversations List */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0D0D0E] p-4 flex flex-col h-full overflow-hidden shadow-premium-card card-sheen">
            
            {/* Search conversations */}
            <div className="relative mb-4 shrink-0">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                placeholder="Search inbox..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                className="h-10 w-full rounded-xl border border-white/10 bg-[#0d0c1d] pl-9 pr-4 text-xs text-white placeholder-slate-500 outline-none transition focus:border-acp-bronze focus:ring-1 focus:ring-acp-bronze"
              />
            </div>

            {/* Chats list */}
            <div className="flex-1 overflow-y-auto space-y-3 pr-1 custom-scrollbar">
              {filteredConversations.length === 0 ? (
                <div className="text-center py-16 text-slate-550 text-xs leading-relaxed font-sans">
                  {searchQuery ? "No conversations match your search." : "No conversations yet."}
                </div>
              ) : (
                filteredConversations.map((conv) => {
                  const isSelected = activeLenderId === conv.lender.id;

                  return (
                    <div key={conv.lender.id} className="space-y-1.5">
                      {/* Parent Lender Item */}
                      <button
                        onClick={() => handleSelectLender(conv)}
                        className={cx(
                          "w-full text-left p-3.5 rounded-xl border transition-all duration-300 relative block cursor-pointer card-sheen",
                          isSelected
                            ? "bg-acp-bronze/10 border-acp-bronze/50 shadow-glow-bronze/5"
                            : "border-white/[0.04] bg-[#0c1122]/15 hover:bg-[#0c1122]/55 hover:border-white/12"
                        )}
                      >
                        {/* Name + Time */}
                        <div className="flex justify-between items-center gap-2">
                          <span className={cx(
                            "text-xs font-black uppercase tracking-wider transition-colors flex items-center gap-1.5",
                            isSelected ? "text-acp-bronze" : "text-white"
                          )}>
                            {isSelected ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            {conv.lender.Company_Name}
                          </span>
                          <span className="text-[9px] text-slate-550 font-semibold shrink-0">
                            {formatTime(conv.latestMsg.timestamp)}
                          </span>
                        </div>

                        {/* Counts & Status info */}
                        <div className="flex justify-between items-center mt-2.5">
                          <span className="text-[9px] text-slate-450 font-bold uppercase tracking-wider">
                            {conv.deals.length} {conv.deals.length === 1 ? "Deal Category" : "Deal Categories"}
                          </span>
                          <div className="flex items-center gap-1.5 shrink-0">
                            <span className="text-[8px] bg-white/5 border border-white/10 text-slate-400 px-1.5 py-0.5 rounded font-mono font-bold">
                              {conv.totalCount} {conv.totalCount === 1 ? "msg" : "msgs"}
                            </span>
                            {conv.unreadCount > 0 && (
                              <span className="inline-flex items-center justify-center h-4.5 min-w-[18px] text-[8px] font-black uppercase bg-[#C5A059] text-white px-1.5 rounded-full shadow-[0_2px_8px_rgba(197,160,89,0.3)] animate-pulse">
                                {conv.unreadCount}
                              </span>
                            )}
                          </div>
                        </div>
                      </button>

                      {/* Sub-list of Deal Conversations (rendered when this lender is selected) */}
                      {isSelected && (
                        <div className="pl-3 border-l border-white/10 ml-4 space-y-1.5 py-1">
                          {conv.deals.map((dealConv) => {
                            const isDealSelected = activeDealId === dealConv.dealId;
                            const isDealMsgMe = dealConv.latestMsg.sender === "Admin";
                            
                            return (
                              <button
                                key={dealConv.dealId}
                                onClick={() => setSearchParams({
                                  lenderId: conv.lender.id,
                                  dealId: dealConv.dealId
                                })}
                                className={cx(
                                  "w-full text-left p-2.5 rounded-lg border transition-all duration-300 block cursor-pointer relative",
                                  isDealSelected
                                    ? "bg-white/5 border-white/10 text-white font-bold"
                                    : "border-transparent bg-transparent hover:bg-white/[0.02] text-slate-400 hover:text-white"
                                )}
                              >
                                <div className="flex justify-between items-center gap-2">
                                  <span className="text-[10px] font-semibold truncate flex-1 flex items-center gap-1">
                                    <FolderDot className={cx("h-3 w-3 shrink-0", isDealSelected ? "text-acp-bronze" : "text-slate-500")} />
                                    {dealConv.companyName} {dealConv.dealRef ? `(${dealConv.dealRef})` : ""}
                                  </span>
                                  <span className="text-[8px] text-slate-550 shrink-0 font-mono">
                                    {formatTime(dealConv.latestMsg.timestamp)}
                                  </span>
                                </div>

                                <div className="flex justify-between items-center mt-1.5">
                                  <span className="text-[9px] text-slate-500 font-medium truncate max-w-[170px] italic">
                                    {isDealMsgMe ? "You: " : ""}"{dealConv.latestMsg.message}"
                                  </span>
                                  <div className="flex items-center gap-1 shrink-0">
                                    {dealConv.unreadCount > 0 && (
                                      <span className="h-3.5 min-w-[14px] inline-flex items-center justify-center text-[7px] font-black bg-[#C5A059] text-white px-1 rounded-full animate-pulse">
                                        {dealConv.unreadCount}
                                      </span>
                                    )}
                                  </div>
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </div>

          {/* Right Pane: Split-pane Chat Frame */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0D0D0E] overflow-hidden flex flex-col h-full shadow-premium-card card-sheen">
            {selectedConversation && activeDealId ? (
              <div className="flex-1 h-full flex flex-col min-h-0">
                <DealChat
                  key={`${activeDealId}-${activeLenderId}`}
                  mode="admin"
                  dealId={activeDealId}
                  lenderRecordId={activeLenderId}
                  lenderName={`${selectedConversation.lender.Company_Name} — ${
                    selectedConversation.deals.find((d) => d.dealId === activeDealId)?.companyName || "Deal Room"
                  }`}
                />
              </div>
            ) : (
              <div className="flex-1 flex flex-col items-center justify-center text-center p-8">
                <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-white/5 border border-white/10 text-slate-400 mb-4 shadow-sm animate-pulse">
                  <MessageSquare className="h-7 w-7" />
                </div>
                <h3 className="text-sm font-bold text-white uppercase tracking-wider">Select a Conversation</h3>
                <p className="text-xs text-slate-500 mt-1 max-w-xs leading-relaxed">
                  Choose a lender thread and select a deal from the left side panel to review transaction messages and chat history.
                </p>
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}
