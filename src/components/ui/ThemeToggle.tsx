import { Moon, Sun } from "lucide-react";
import { useTheme } from "../../hooks/useTheme";
import { cx } from "../../utils/cx";

/** Switches the whole app between light and dark mode. */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const next = theme === "light" ? "dark" : "light";

  return (
    <button
      type="button"
      onClick={toggleTheme}
      className={cx(
        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-white/[0.08] bg-white/[0.03] text-slate-400 hover:text-white hover:bg-white/[0.06] transition cursor-pointer",
        className,
      )}
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
    >
      {theme === "light" ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
    </button>
  );
}
