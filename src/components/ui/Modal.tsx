import type { ReactNode } from "react";
import { X } from "lucide-react";
import { useEffect } from "react";
import { createPortal } from "react-dom";

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
  footer,
  subHeader,
  onSubmit,
}: {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  maxWidth?: string;
  footer?: ReactNode;
  subHeader?: ReactNode;
  onSubmit?: (e: React.FormEvent) => void;
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

  const modalContent = (
    <>
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

      {/* Sub-header */}
      {subHeader && (
        <div className="px-6 py-4 border-b border-white/[0.02] bg-white/[0.005] shrink-0">
          {subHeader}
        </div>
      )}

      {/* Body */}
      <div className="p-6 pt-5 overflow-y-auto custom-scrollbar flex-1 min-h-0">
        {children}
      </div>

      {/* Footer */}
      {footer && (
        <div className="p-6 pt-4 border-t border-white/[0.02] bg-white/[0.005] shrink-0">
          {footer}
        </div>
      )}
    </>
  );

  return createPortal(
    // On phones the dialog is a bottom sheet, the native pattern there; from
    // sm up it is the centred card it has always been.
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4 max-sm:items-end max-sm:p-0"
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
        className={`relative z-10 w-full ${maxWidth} flex flex-col rounded-2xl border border-white/[0.1] bg-acp-card shadow-2xl animate-scale-in max-h-[85vh] overflow-hidden max-sm:max-w-none max-sm:rounded-b-none max-sm:rounded-t-[28px] max-sm:border-x-0 max-sm:border-b-0 max-sm:max-h-[92dvh] max-sm:animate-sheet-up max-sm:pb-safe`}
      >
        <div className="sm:hidden flex justify-center pt-3 -mb-3 shrink-0" aria-hidden="true">
          <span className="h-1.5 w-10 rounded-full bg-white/[0.15]" />
        </div>
        {onSubmit ? (
          <form onSubmit={onSubmit} className="flex flex-col flex-1 min-h-0 overflow-hidden">
            {modalContent}
          </form>
        ) : (
          modalContent
        )}
      </div>
    </div>,
    document.body
  );
}
