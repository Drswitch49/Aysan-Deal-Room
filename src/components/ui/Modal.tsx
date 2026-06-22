import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useEffect } from "react";

/**
 * Shared modal wrapper with backdrop blur, Escape-key close support,
 * and consistent header pattern.
 */
export function Modal({
  isOpen,
  onClose,
  title,
  children,
  maxWidth = "max-w-md",
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
}) {
  // Escape key handler
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [isOpen, onClose]);

  // Body scroll lock
  useEffect(() => {
    if (!isOpen) return;
    const originalOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = originalOverflow;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const titleId = `modal-title-${title.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/65 backdrop-blur-sm animate-fade-in"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Modal Panel */}
      <div
        className={`relative z-10 w-full ${maxWidth} flex flex-col rounded-2xl border border-white/[0.1] bg-[#161B22] shadow-2xl animate-scale-in overflow-hidden`}
        style={{ maxHeight: '90vh' }}
      >
        {/* Header */}
        <div className="flex items-center justify-between p-6 pb-4 border-b border-white/[0.02] shrink-0">
          <h3
            id={titleId}
            className="text-sm font-bold text-white tracking-tight"
          >
            {title}
          </h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.08] transition cursor-pointer"
            aria-label="Close modal"
          >
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        {/* Body */}
        <div className="p-6 pt-5 overflow-y-auto custom-scrollbar flex-1 min-h-0">
          {children}
        </div>
      </div>
    </div>
  );
}
