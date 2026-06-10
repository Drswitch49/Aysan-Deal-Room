import type { JobStatus } from "../../hooks/useJobStatus";
import { getStatusColor } from "../../hooks/useJobStatus";

/**
 * WorkflowStatusBadge — Displays real Inngest workflow processing states.
 *
 * Shows live job status with appropriate icons, colors, and animation.
 * Designed to be embedded in document rows, upload cards, and pipeline views.
 *
 * States:
 *  queued      → amber pulsing    (waiting in Inngest queue)
 *  processing  → blue spinning    (file download / setup)
 *  extracted   → blue             (text extracted, awaiting AI)
 *  analyzing   → purple pulsing   (Claude analyzing)
 *  completed   → green            (done)
 *  failed      → red              (error with message)
 *  unknown     → gray             (not started or status unclear)
 */

interface WorkflowStatusBadgeProps {
  status: JobStatus;
  error?: string | null;
  /** If true, renders as a compact inline badge without label */
  compact?: boolean;
  /** Optional className override */
  className?: string;
}

const STATUS_CONFIG: Record<
  JobStatus,
  { label: string; icon: string; animate: "pulse" | "spin" | "none"; bg: string; text: string }
> = {
  queued: {
    label: "Queued",
    icon: "⏳",
    animate: "pulse",
    bg: "rgba(245, 158, 11, 0.12)",
    text: "#f59e0b",
  },
  processing: {
    label: "Processing…",
    icon: "⚙",
    animate: "spin",
    bg: "rgba(59, 130, 246, 0.12)",
    text: "#3b82f6",
  },
  extracted: {
    label: "Text Extracted",
    icon: "📄",
    animate: "none",
    bg: "rgba(59, 130, 246, 0.08)",
    text: "#60a5fa",
  },
  analyzing: {
    label: "AI Analyzing…",
    icon: "🤖",
    animate: "pulse",
    bg: "rgba(139, 92, 246, 0.12)",
    text: "#8b5cf6",
  },
  completed: {
    label: "Complete",
    icon: "✓",
    animate: "none",
    bg: "rgba(16, 185, 129, 0.12)",
    text: "#10b981",
  },
  failed: {
    label: "Failed",
    icon: "✕",
    animate: "none",
    bg: "rgba(239, 68, 68, 0.12)",
    text: "#ef4444",
  },
  unknown: {
    label: "Not Started",
    icon: "○",
    animate: "none",
    bg: "rgba(107, 114, 128, 0.08)",
    text: "#6b7280",
  },
};

export function WorkflowStatusBadge({
  status,
  error,
  compact = false,
  className = "",
}: WorkflowStatusBadgeProps) {
  const config = STATUS_CONFIG[status] || STATUS_CONFIG.unknown;

  const animationStyle: React.CSSProperties =
    config.animate === "pulse"
      ? { animation: "workflowPulse 1.5s ease-in-out infinite" }
      : config.animate === "spin"
      ? { animation: "workflowSpin 1s linear infinite", display: "inline-block" }
      : {};

  if (compact) {
    return (
      <span
        className={className}
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 4,
          padding: "2px 6px",
          borderRadius: 4,
          backgroundColor: config.bg,
          border: `1px solid ${config.text}33`,
          fontSize: 11,
          fontWeight: 600,
          color: config.text,
          letterSpacing: "0.02em",
          whiteSpace: "nowrap",
        }}
        title={error ? `Error: ${error}` : config.label}
      >
        <span style={animationStyle}>{config.icon}</span>
        {config.label}
      </span>
    );
  }

  return (
    <>
      {/* Inject keyframe animations once */}
      <style>{`
        @keyframes workflowPulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.5; }
        }
        @keyframes workflowSpin {
          from { transform: rotate(0deg); }
          to { transform: rotate(360deg); }
        }
      `}</style>
      <div
        className={className}
        style={{
          display: "inline-flex",
          flexDirection: "column",
          gap: 2,
        }}
      >
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: 6,
            padding: "4px 10px",
            borderRadius: 6,
            backgroundColor: config.bg,
            border: `1px solid ${config.text}44`,
            fontSize: 12,
            fontWeight: 600,
            color: config.text,
            letterSpacing: "0.02em",
          }}
        >
          <span style={animationStyle}>{config.icon}</span>
          {config.label}
        </span>
        {status === "failed" && error && (
          <span
            style={{
              fontSize: 11,
              color: "#ef4444",
              opacity: 0.8,
              paddingLeft: 2,
              maxWidth: 240,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
            title={error}
          >
            {error}
          </span>
        )}
      </div>
    </>
  );
}

/**
 * WorkflowProgressTracker — Multi-step workflow progress visualization.
 * Shows the pipeline stages with the current active step highlighted.
 */
interface WorkflowProgressTrackerProps {
  status: JobStatus;
  compact?: boolean;
}

const WORKFLOW_STEPS: Array<{ status: JobStatus; label: string }> = [
  { status: "queued", label: "Queued" },
  { status: "processing", label: "Downloading" },
  { status: "extracted", label: "Extracted" },
  { status: "analyzing", label: "AI Analysis" },
  { status: "completed", label: "Complete" },
];

const STATUS_ORDER: Record<JobStatus, number> = {
  unknown: -1,
  queued: 0,
  processing: 1,
  extracted: 2,
  analyzing: 3,
  completed: 4,
  failed: 4,
};

export function WorkflowProgressTracker({
  status,
  compact = false,
}: WorkflowProgressTrackerProps) {
  const currentOrder = STATUS_ORDER[status] ?? -1;
  const isFailed = status === "failed";

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: compact ? 4 : 8,
      }}
    >
      {WORKFLOW_STEPS.map((step, idx) => {
        const stepOrder = STATUS_ORDER[step.status];
        const isDone = currentOrder > stepOrder;
        const isActive = currentOrder === stepOrder && !isFailed;
        const isError = isFailed && currentOrder >= stepOrder && idx === currentOrder;

        const color = isDone
          ? "#10b981"
          : isError
          ? "#ef4444"
          : isActive
          ? getStatusColor(status)
          : "rgba(107, 114, 128, 0.3)";

        return (
          <div key={step.status} style={{ display: "flex", alignItems: "center", gap: compact ? 4 : 8 }}>
            {/* Step dot */}
            <div
              title={step.label}
              style={{
                width: compact ? 6 : 8,
                height: compact ? 6 : 8,
                borderRadius: "50%",
                backgroundColor: color,
                flexShrink: 0,
                boxShadow: isActive ? `0 0 6px ${color}` : undefined,
                animation: isActive ? "workflowPulse 1.5s ease-in-out infinite" : undefined,
              }}
            />
            {/* Connector line */}
            {idx < WORKFLOW_STEPS.length - 1 && (
              <div
                style={{
                  width: compact ? 12 : 20,
                  height: 1,
                  backgroundColor: isDone ? "#10b981" : "rgba(107, 114, 128, 0.2)",
                  flexShrink: 0,
                }}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
