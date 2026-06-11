import type { ReactNode } from "react";

/**
 * Consistent form field wrapper: label + input/select/textarea.
 * Eliminates the repeated `space-y-1.5` + label pattern across forms.
 */
export function FormField({
  label,
  required,
  children,
  hint,
  id,
}: {
  label: string;
  required?: boolean;
  children: ReactNode;
  hint?: string;
  id?: string;
}) {
  return (
    <div className="space-y-2">
      <label 
        htmlFor={id} 
        className="block text-[10px] font-semibold tracking-wide text-slate-400/95 select-none"
      >
        {label}
        {required && <span className="ml-0.5 text-[#C6A66B]">*</span>}
      </label>
      {children}
      {hint && (
        <p className="text-[10px] text-slate-500 leading-relaxed font-medium">{hint}</p>
      )}
    </div>
  );
}

/**
 * Shared input class string for consistent input styling.
 */
export const inputClass =
  "h-10 w-full rounded-xl border border-white/[0.02] bg-[#0F1115] px-3.5 text-xs text-white placeholder-slate-650 outline-none focus:border-[#C6A66B] focus:bg-[#0F1115] focus:ring-1 focus:ring-[#C6A66B]/20 transition duration-150 shadow-inner";

/**
 * Shared select class string.
 */
export const selectClass =
  "h-10 w-full rounded-xl border border-white/[0.02] bg-[#0F1115] px-3.5 text-xs text-white outline-none focus:border-[#C6A66B] focus:ring-1 focus:ring-[#C6A66B]/20 transition duration-150 cursor-pointer shadow-inner";

/**
 * Shared textarea class string.
 */
export const textareaClass =
  "w-full rounded-xl border border-white/[0.02] bg-[#0F1115] px-3.5 py-3 text-xs text-white placeholder-slate-650 outline-none focus:border-[#C6A66B] focus:bg-[#0F1115] focus:ring-1 focus:ring-[#C6A66B]/20 transition duration-150 resize-none font-sans leading-relaxed shadow-inner";
