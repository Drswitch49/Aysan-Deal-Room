import { Download, ExternalLink } from "lucide-react";
import type { AnchorHTMLAttributes } from "react";
import { cx } from "../../utils/cx";

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  icon?: "view" | "download";
  variant?: "primary" | "secondary" | "purple";
};

export function ButtonLink({ children, className, icon, variant = "secondary", ...props }: ButtonLinkProps) {
  const Icon = icon === "download" ? Download : ExternalLink;

  return (
    <a
      className={cx(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0",
        variant === "primary"
          ? "bg-gradient-to-r from-acp-blue to-acp-cobalt text-white hover:shadow-glow-blue border border-transparent"
          : variant === "purple"
            ? "bg-gradient-to-r from-acp-purple to-acp-purple-dark text-white hover:shadow-glow-purple border border-transparent"
            : "border border-white/10 bg-white/5 text-slate-300 hover:border-white/20 hover:bg-white/10 hover:text-white",
        props.href ? "cursor-pointer" : "pointer-events-none opacity-40",
        className,
      )}
      target="_blank"
      rel="noreferrer"
      {...props}
    >
      {icon ? <Icon className="h-3.5 w-3.5 transition-transform duration-300 group-hover:scale-110" aria-hidden="true" /> : null}
      {children}
    </a>
  );
}
