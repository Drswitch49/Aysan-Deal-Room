import { Download, ExternalLink } from "lucide-react";
import type { AnchorHTMLAttributes } from "react";
import { cx } from "../../utils/cx";

type ButtonLinkProps = AnchorHTMLAttributes<HTMLAnchorElement> & {
  icon?: "view" | "download";
  variant?: "primary" | "secondary" | "purple";
};

export function ButtonLink({ children, className, icon, variant = "secondary", href, onClick, ...props }: ButtonLinkProps) {
  const Icon = icon === "download" ? Download : ExternalLink;
  const hasHref = href && href.trim() !== "" && href !== "#";

  // If there's no href and no onClick, render a disabled span
  if (!hasHref && !onClick) {
    return (
      <span
        className={cx(
          "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-bold uppercase tracking-wider shadow-sm border border-white/5 bg-white/[0.02] text-slate-500 opacity-40 cursor-not-allowed select-none",
          className
        )}
      >
        {icon ? <Icon className="h-3.5 w-3.5" aria-hidden="true" /> : null}
        {children}
      </span>
    );
  }

  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    if (onClick) {
      onClick(e);
    }
  };

  return (
    <a
      href={hasHref ? href : undefined}
      onClick={handleClick}
      className={cx(
        "inline-flex min-h-9 items-center justify-center gap-2 rounded-lg px-3.5 text-xs font-bold uppercase tracking-wider shadow-sm transition-all duration-300 transform hover:-translate-y-0.5 active:translate-y-0 cursor-pointer",
        variant === "primary"
          ? "bg-gradient-to-r from-acp-bronze to-acp-bronze text-white hover:shadow-glow-bronze border border-transparent"
          : variant === "purple"
            ? "bg-gradient-to-r from-acp-bronze to-acp-bronze-dark text-white hover:shadow-glow-bronze border border-transparent"
            : "border border-white/10 bg-white/5 text-slate-350 hover:border-white/20 hover:bg-white/10 hover:text-white",
        className
      )}
      target={hasHref ? "_blank" : undefined}
      rel={hasHref ? "noreferrer" : undefined}
      {...props}
    >
      {icon ? <Icon className="h-3.5 w-3.5 transition-transform duration-300 group-hover:scale-110" aria-hidden="true" /> : null}
      {children}
    </a>
  );
}
