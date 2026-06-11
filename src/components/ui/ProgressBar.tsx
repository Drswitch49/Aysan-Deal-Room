export function ProgressBar({ value, label }: { value: number; label: string }) {
  const boundedValue = Math.max(0, Math.min(100, value));

  return (
    <div className="w-full">
      <div className="mb-2.5 flex items-center justify-between gap-4 text-xs font-bold uppercase tracking-wider text-slate-500">
        <span>{label}</span>
        <span className="font-semibold text-acp-bronze">{Math.round(boundedValue)}%</span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100/80 border border-slate-200/50 shadow-inner">
        <div 
          className="h-full rounded-full bg-gradient-to-r from-acp-bronze via-acp-bronze to-acp-emerald relative shadow-[0_0_8px_rgba(197,160,89,0.3)] transition-all duration-1000 ease-out" 
          style={{ width: `${boundedValue}%` }}
        >
          {boundedValue > 0 && boundedValue < 100 && (
            <div className="absolute right-0 top-0 h-full w-2 rounded-full bg-white opacity-60 animate-pulse-glow" />
          )}
        </div>
      </div>
    </div>
  );
}

export function ProgressRing({ value, size = 64, strokeWidth = 5 }: { value: number; size?: number; strokeWidth?: number }) {
  const boundedValue = Math.max(0, Math.min(100, value));
  const radius = (size - strokeWidth) / 2;
  const circumference = radius * 2 * Math.PI;
  const offset = circumference - (boundedValue / 100) * circumference;

  return (
    <div className="relative flex items-center justify-center" style={{ width: size, height: size }}>
      <svg className="transform -rotate-90" width={size} height={size}>
        {/* Background Circle */}
        <circle
          className="text-slate-100"
          strokeWidth={strokeWidth}
          stroke="currentColor"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        {/* Progress Circle with Gradient */}
        <circle
          className="transition-all duration-1000 ease-out"
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          stroke="url(#progressRingGradient)"
          fill="transparent"
          r={radius}
          cx={size / 2}
          cy={size / 2}
        />
        <defs>
          <linearGradient id="progressRingGradient" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#C6A66B" />
            <stop offset="50%" stopColor="#6366f1" />
            <stop offset="100%" stopColor="#10b981" />
          </linearGradient>
        </defs>
      </svg>
      {/* Center text */}
      <span className="absolute text-[11px] font-extrabold text-slate-800">{Math.round(boundedValue)}%</span>
    </div>
  );
}
