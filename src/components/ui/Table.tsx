import type { ReactNode, ThHTMLAttributes, TdHTMLAttributes } from "react";

export function Table({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-xl border border-white/10 bg-acp-card backdrop-blur-md shadow-premium-card w-full">
      <div className="overflow-x-auto w-full">
        <table className="w-full min-w-full divide-y divide-white/5 text-sm">{children}</table>
      </div>
    </div>
  );
}

export function Th({ children, className = "", ...props }: { children: ReactNode } & ThHTMLAttributes<HTMLTableCellElement>) {
  return (
    <th 
      className={`px-6 py-4 text-left text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400 select-none border-b border-white/5 bg-white/[0.02] ${className}`}
      {...props}
    >
      {children}
    </th>
  );
}

export function Td({ children, className = "", ...props }: { children: ReactNode } & TdHTMLAttributes<HTMLTableCellElement>) {
  return (
    <td 
      className={`px-6 py-4 align-middle text-slate-300 font-medium transition-colors duration-250 ${className}`}
      {...props}
    >
      {children}
    </td>
  );
}
