import { useState, useEffect, useRef } from "react";
import { 
  Sparkles, Upload, FileText, FileVideo, AlertCircle, CheckSquare, 
  Square, ShieldAlert, TrendingUp, HelpCircle, Loader2, Calendar, 
  ChevronDown, ChevronUp, History, BrainCircuit, Check, Plus
} from "lucide-react";
import { analyzeTranscript, fetchTranscriptAnalyses } from "../../api/admin";
import { cx } from "../../utils/cx";

interface TranscriptIntelTabProps {
  deal: any;
}

export function TranscriptIntelTab({ deal }: TranscriptIntelTabProps) {
  const [analyses, setAnalyses] = useState<any[]>([]);
  const [selectedAnalysis, setSelectedAnalysis] = useState<any | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Input states
  const [pastedText, setPastedText] = useState("");
  const [uploadedFileName, setUploadedFileName] = useState("");
  const [uploadedText, setUploadedText] = useState("");
  const [dragActive, setDragActive] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Loader progress animation steps
  const [loadingStep, setLoadingStep] = useState(0);
  const steps = [
    "Normalizing transcript formats...",
    "Invoking Claude 3.5 Sonnet...",
    "Extracting key deal parameters...",
    "Computing risks & opportunities...",
    "Storing intelligence to Airtable..."
  ];

  useEffect(() => {
    if (deal?.id) {
      loadAnalyses();
    }
  }, [deal?.id]);

  // Loader step timing
  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (isAnalyzing) {
      setLoadingStep(0);
      interval = setInterval(() => {
        setLoadingStep((prev) => (prev < steps.length - 1 ? prev + 1 : prev));
      }, 3000);
    }
    return () => clearInterval(interval);
  }, [isAnalyzing]);

  async function loadAnalyses() {
    setIsLoading(true);
    setError(null);
    try {
      const data = await fetchTranscriptAnalyses(deal.id);
      setAnalyses(data);
      if (data.length > 0) {
        setSelectedAnalysis(data[0]); // default to most recent
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to load past transcript analyses.");
    } finally {
      setIsLoading(false);
    }
  }

  // Handle file reading
  const handleFileText = (file: File) => {
    setUploadedFileName(file.name);
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      setUploadedText(text);
    };
    reader.readAsText(file);
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files && e.target.files[0]) {
      handleFileText(e.target.files[0]);
    }
  };

  const handleDrag = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (e.type === "dragenter" || e.type === "dragover") {
      setDragActive(true);
    } else if (e.type === "dragleave") {
      setDragActive(false);
    }
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setDragActive(false);
    if (e.dataTransfer.files && e.dataTransfer.files[0]) {
      handleFileText(e.dataTransfer.files[0]);
    }
  };

  const handleAnalyze = async () => {
    const textToAnalyze = uploadedText || pastedText;
    if (!textToAnalyze.trim()) return;

    setIsAnalyzing(true);
    setError(null);
    try {
      const result = await analyzeTranscript(deal.id, textToAnalyze, uploadedFileName || "Manual Paste");
      setAnalyses((prev) => [result, ...prev]);
      setSelectedAnalysis(result);
      // Reset inputs
      setPastedText("");
      setUploadedText("");
      setUploadedFileName("");
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Transcript analysis failed. Please verify API configuration.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const clearInputs = () => {
    setPastedText("");
    setUploadedText("");
    setUploadedFileName("");
  };

  // Checkbox interactivity
  const [completedItems, setCompletedItems] = useState<Record<string, boolean>>({});
  const toggleActionItem = (itemText: string) => {
    setCompletedItems((prev) => ({
      ...prev,
      [itemText]: !prev[itemText]
    }));
  };

  // Collapsible sections
  const [isSummaryCollapsed, setIsSummaryCollapsed] = useState(false);

  return (
    <div className="space-y-6 animate-fade-in-up">
      {/* Header and history selector */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h3 className="text-lg font-bold text-white flex items-center gap-2">
            <BrainCircuit className="h-5 w-5 text-amber-500" />
            Transcript Intelligence
          </h3>
          <p className="text-xs text-slate-400 mt-1">
            Analyze call logs, Zoom transcripts, and meeting summaries using Claude 3.5.
          </p>
        </div>

        {analyses.length > 0 && (
          <div className="flex items-center gap-2">
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider flex items-center gap-1 select-none">
              <History className="h-3 w-3" />
              History:
            </span>
            <select
              value={selectedAnalysis?.id || ""}
              onChange={(e) => {
                const matched = analyses.find((a) => a.id === e.target.value);
                if (matched) setSelectedAnalysis(matched);
              }}
              className="rounded-lg border border-white/10 bg-[#0E121A] px-3 py-1.5 text-xs font-semibold text-slate-200 outline-none hover:border-white/20 focus:border-amber-500/50"
            >
              {analyses.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name.replace("Analysis: ", "")}
                </option>
              ))}
            </select>

            <button
              onClick={() => setSelectedAnalysis(null)}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-slate-400 hover:text-white hover:bg-white/10 transition"
              title="Perform new analysis"
            >
              <Plus className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>

      {error && (
        <div className="flex items-start gap-3 rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <AlertCircle className="h-5 w-5 text-rose-500 shrink-0 mt-0.5" />
          <div>
            <h4 className="text-sm font-semibold text-white">Analysis Failed</h4>
            <p className="text-xs text-rose-200 mt-1 leading-relaxed">{error}</p>
          </div>
        </div>
      )}

      {/* Main Content Layout */}
      {isAnalyzing ? (
        /* Dynamic step progress loader */
        <div className="rounded-2xl border border-white/15 bg-acp-card backdrop-blur-md p-10 flex flex-col items-center justify-center space-y-6 min-h-[350px]">
          <div className="relative flex items-center justify-center">
            <Loader2 className="h-12 w-12 text-amber-500 animate-spin" />
            <div className="absolute h-6 w-6 rounded-full bg-amber-500/10 animate-ping" />
          </div>
          <div className="text-center space-y-2">
            <h4 className="text-base font-bold text-white">Analyzing Meeting Intelligence</h4>
            <p className="text-xs text-amber-450 font-medium select-none tracking-wide animate-pulse">
              {steps[loadingStep]}
            </p>
          </div>
          <div className="w-full max-w-xs bg-white/5 rounded-full h-1.5 overflow-hidden">
            <div 
              className="bg-amber-500 h-1.5 rounded-full transition-all duration-700 ease-out" 
              style={{ width: `${((loadingStep + 1) / steps.length) * 100}%` }}
            />
          </div>
        </div>
      ) : selectedAnalysis ? (
        /* Results View */
        <div className="grid grid-cols-1 lg:grid-cols-[1fr_300px] gap-6 items-start">
          
          {/* Main analysis block */}
          <div className="space-y-6">
            {/* Top overview row */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-6 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between shadow-premium">
              <div className="space-y-1">
                <div className="flex items-center gap-2">
                  <h4 className="text-base font-bold text-white">{selectedAnalysis.name.split(" - ")[0]}</h4>
                  <span className={cx(
                    "rounded-full px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider border",
                    selectedAnalysis.sentiment === "Positive" && "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
                    selectedAnalysis.sentiment === "Neutral" && "bg-amber-500/10 text-amber-400 border-amber-500/20",
                    selectedAnalysis.sentiment === "Negative" && "bg-rose-500/10 text-rose-400 border-rose-500/20"
                  )}>
                    {selectedAnalysis.sentiment} Sentiment
                  </span>
                </div>
                <div className="flex items-center gap-1.5 text-xs text-slate-400">
                  <Calendar className="h-3.5 w-3.5" />
                  <span>Analyzed on {new Date(selectedAnalysis.timestamp).toLocaleString("en-US", { month: "short", day: "numeric", year: "numeric", hour: "2-digit", minute: "2-digit" })}</span>
                </div>
              </div>

              {/* Deal Score Badge */}
              <div className="flex items-center gap-4 border-l border-white/5 pl-6 sm:border-l sm:pl-6 shrink-0">
                <div className="text-right">
                  <span className="text-[10px] font-bold text-slate-500 uppercase tracking-widest block">Deal Quality</span>
                  <span className="text-xs text-slate-400 font-semibold mt-0.5 block">AI Assessment</span>
                </div>
                <div className="relative flex items-center justify-center h-16 w-16">
                  {/* Outer circle */}
                  <svg className="absolute h-full w-full -rotate-90">
                    <circle 
                      cx="32" cy="32" r="28" 
                      className="stroke-white/5 fill-none" 
                      strokeWidth="4"
                    />
                    <circle 
                      cx="32" cy="32" r="28" 
                      className={cx(
                        "fill-none stroke-dasharray-[176] transition-all duration-1000",
                        selectedAnalysis.dealScore >= 70 ? "stroke-emerald-500" : selectedAnalysis.dealScore >= 50 ? "stroke-amber-500" : "stroke-rose-500"
                      )} 
                      strokeWidth="4"
                      strokeDashoffset={176 - (176 * selectedAnalysis.dealScore) / 100}
                    />
                  </svg>
                  <span className="text-base font-extrabold text-white z-10">{selectedAnalysis.dealScore}%</span>
                </div>
              </div>
            </div>

            {/* Executive Summary Card */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] overflow-hidden shadow-premium">
              <button
                onClick={() => setIsSummaryCollapsed(!isSummaryCollapsed)}
                className="w-full px-6 py-4 flex items-center justify-between border-b border-white/[0.05] hover:bg-white/[0.02] transition"
              >
                <span className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-2 select-none">
                  <Sparkles className="h-4 w-4 text-amber-500" />
                  Executive Summary
                </span>
                {isSummaryCollapsed ? <ChevronDown className="h-4 w-4 text-slate-400" /> : <ChevronUp className="h-4 w-4 text-slate-400" />}
              </button>
              
              {!isSummaryCollapsed && (
                <div className="p-6 text-sm text-slate-300 leading-relaxed font-medium bg-[#0E121A]">
                  {selectedAnalysis.summary}
                </div>
              )}
            </div>

            {/* Risks vs Opportunities Side-by-Side */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
              {/* Opportunities Panel */}
              <div className="rounded-2xl border border-emerald-500/10 bg-[#0E121A] p-6 space-y-4 shadow-premium">
                <h4 className="text-xs font-bold uppercase tracking-wider text-emerald-400 flex items-center gap-2 border-b border-white/5 pb-3">
                  <TrendingUp className="h-4 w-4" />
                  Opportunities Identified
                </h4>
                <ul className="space-y-3">
                  {selectedAnalysis.opportunities.length > 0 ? (
                    selectedAnalysis.opportunities.map((item: string, idx: number) => (
                      <li key={idx} className="flex gap-2.5 items-start text-xs text-slate-300 leading-relaxed">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-500" />
                        <span>{item}</span>
                      </li>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 italic">No specific opportunities highlighted.</p>
                  )}
                </ul>
              </div>

              {/* Risks Panel */}
              <div className="rounded-2xl border border-rose-500/10 bg-[#0E121A] p-6 space-y-4 shadow-premium">
                <h4 className="text-xs font-bold uppercase tracking-wider text-rose-400 flex items-center gap-2 border-b border-white/5 pb-3">
                  <ShieldAlert className="h-4 w-4" />
                  Risks & Constraints
                </h4>
                <ul className="space-y-3">
                  {selectedAnalysis.risks.length > 0 ? (
                    selectedAnalysis.risks.map((item: string, idx: number) => (
                      <li key={idx} className="flex gap-2.5 items-start text-xs text-slate-300 leading-relaxed">
                        <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-rose-500" />
                        <span>{item}</span>
                      </li>
                    ))
                  ) : (
                    <p className="text-xs text-slate-500 italic">No immediate risks identified.</p>
                  )}
                </ul>
              </div>
            </div>

            {/* Key Discussion Points */}
            <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-6 space-y-4 shadow-premium">
              <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-white/5 pb-3 flex items-center gap-2 select-none">
                <HelpCircle className="h-4 w-4 text-blue-500" />
                Key Discussion Points
              </h4>
              <ul className="space-y-3">
                {selectedAnalysis.discussionPoints.map((item: string, idx: number) => (
                  <li key={idx} className="flex gap-3 items-start text-xs text-slate-300 leading-relaxed bg-white/[0.01] border border-white/[0.03] rounded-xl p-3.5 hover:border-white/10 hover:bg-white/[0.02] transition">
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/5 border border-white/10 text-slate-400 text-[10px] font-bold">
                      {idx + 1}
                    </span>
                    <span>{item}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Sidebar Action Items List */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-6 space-y-4 shadow-premium lg:sticky lg:top-6">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-white/5 pb-3 flex items-center gap-2 select-none">
              <CheckSquare className="h-4 w-4 text-amber-500" />
              Action Items
            </h4>
            <div className="space-y-3">
              {selectedAnalysis.actionItems.length > 0 ? (
                selectedAnalysis.actionItems.map((item: string, idx: number) => {
                  const isCompleted = !!completedItems[item];
                  return (
                    <button
                      key={idx}
                      onClick={() => toggleActionItem(item)}
                      className="w-full text-left flex gap-3 items-start p-2.5 rounded-lg hover:bg-white/5 transition group"
                    >
                      <span className="mt-0.5 shrink-0 text-slate-405 group-hover:text-amber-500 transition">
                        {isCompleted ? (
                          <CheckSquare className="h-4 w-4 text-emerald-500 fill-emerald-500/10" />
                        ) : (
                          <Square className="h-4 w-4" />
                        )}
                      </span>
                      <span className={cx(
                        "text-xs leading-relaxed transition",
                        isCompleted ? "text-slate-500 line-through" : "text-slate-300"
                      )}>
                        {item}
                      </span>
                    </button>
                  );
                })
              ) : (
                <p className="text-xs text-slate-500 italic">No action items generated.</p>
              )}
            </div>
          </div>
        </div>
      ) : (
        /* File Uploader / Paste Panel */
        <div className="grid grid-cols-1 md:grid-cols-[1fr_350px] gap-6 items-start">
          {/* Uploader drag area */}
          <div className="space-y-6">
            <div
              onDragEnter={handleDrag}
              onDragOver={handleDrag}
              onDragLeave={handleDrag}
              onDrop={handleDrop}
              className={cx(
                "rounded-2xl border-2 border-dashed p-10 flex flex-col items-center justify-center space-y-4 transition-all min-h-[250px]",
                dragActive ? "border-amber-500 bg-amber-500/5" : "border-white/10 bg-[#0E121A] hover:border-white/20"
              )}
            >
              {uploadedFileName ? (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-amber-500/10 border border-amber-500/20 text-amber-400">
                  {uploadedFileName.endsWith(".vtt") || uploadedFileName.endsWith(".srt") ? (
                    <FileVideo className="h-6 w-6 animate-pulse" />
                  ) : (
                    <FileText className="h-6 w-6 animate-pulse" />
                  )}
                </div>
              ) : (
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-white/5 border border-white/10 text-slate-400">
                  <Upload className="h-6 w-6" />
                </div>
              )}
              
              <div className="text-center space-y-1">
                <p className="text-sm font-semibold text-white">
                  {uploadedFileName ? uploadedFileName : "Upload meeting transcript file"}
                </p>
                <p className="text-xs text-slate-405">
                  Drag and drop your file here, or click to browse.
                </p>
                <p className="text-[10px] text-slate-500 font-medium pt-1">
                  Supports Zoom transcripts, WebVTT (.vtt), SRT (.srt), or plain text (.txt).
                </p>
              </div>

              <input
                ref={fileInputRef}
                type="file"
                accept=".txt,.vtt,.srt"
                onChange={handleFileInput}
                className="hidden"
              />

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  className="rounded-lg border border-white/10 bg-white/5 px-4 py-2 text-xs font-semibold text-white hover:bg-white/10 transition"
                >
                  Choose File
                </button>
                {uploadedFileName && (
                  <button
                    type="button"
                    onClick={clearInputs}
                    className="rounded-lg border border-rose-500/20 bg-rose-500/5 px-4 py-2 text-xs font-semibold text-rose-400 hover:bg-rose-500/10 transition"
                  >
                    Clear File
                  </button>
                )}
              </div>
            </div>

            {/* Pasting alternative */}
            {!uploadedFileName && (
              <div className="space-y-2">
                <label className="text-xs font-bold text-slate-450 uppercase tracking-wider select-none block">
                  Or Paste Transcript Text Manually
                </label>
                <textarea
                  value={pastedText}
                  onChange={(e) => setPastedText(e.target.value)}
                  placeholder="Paste raw conversation transcript here..."
                  className="w-full min-h-[160px] rounded-xl border border-white/10 bg-[#0E121A] p-4 text-xs font-medium text-slate-200 outline-none placeholder:text-slate-600 focus:border-amber-500/50 resize-y"
                />
              </div>
            )}
          </div>

          {/* Action Trigger Card */}
          <div className="rounded-2xl border border-white/[0.06] bg-[#0E121A] p-6 space-y-4 shadow-premium">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 border-b border-white/5 pb-3 flex items-center gap-2 select-none">
              <Sparkles className="h-4 w-4 text-amber-500" />
              AI Summary Engine
            </h4>
            <p className="text-xs text-slate-400 leading-relaxed font-medium">
              Claude 3.5 will analyze key topics, action items, risks, opportunities, sentiment, and compute a deal score to save directly to your database.
            </p>
            <button
              disabled={!uploadedText.trim() && !pastedText.trim()}
              onClick={handleAnalyze}
              className="w-full py-2.5 rounded-xl bg-amber-500 text-[#07090e] text-xs font-bold flex items-center justify-center gap-2 hover:bg-amber-400 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:bg-amber-500 transition-all shadow-lg shadow-amber-500/10"
            >
              <Sparkles className="h-4 w-4" />
              Analyze Call Transcript
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
