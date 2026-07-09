import { useState, useEffect, useRef } from "react";
import { ChevronDown } from "lucide-react";
import { inputClass } from "./FormField";
import { cx } from "../../utils/cx";

export interface SearchableDropdownProps {
  value: string;
  onChange: (val: string) => void;
  options: string[];
  placeholder?: string;
  required?: boolean;
  name?: string;
  id?: string;
}

export function SearchableDropdown({
  value,
  onChange,
  options,
  placeholder = "Search or select...",
  required = false,
  name,
  id,
}: SearchableDropdownProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Sync initial query with incoming value
  useEffect(() => {
    setSearchQuery(value);
  }, [value]);

  // Handle click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
        // Reset query to the actual value if user typed but didn't select anything
        setSearchQuery(value);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [value]);

  const filteredOptions = options.filter((option) =>
    option.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setSearchQuery(e.target.value);
    onChange(e.target.value);
    setIsOpen(true);
  };

  const handleSelect = (option: string) => {
    onChange(option);
    setSearchQuery(option);
    setIsOpen(false);
  };

  return (
    <div ref={dropdownRef} className="relative w-full">
      <div className="relative">
        <input
          type="text"
          id={id}
          name={name}
          required={required}
          value={searchQuery}
          onChange={handleInputChange}
          onFocus={() => setIsOpen(true)}
          placeholder={placeholder}
          className={cx(inputClass, "pr-10")}
          autoComplete="off"
        />
        <div className="absolute right-3 top-1/2 -translate-y-1/2 flex items-center gap-1 pointer-events-none text-slate-500">
          <ChevronDown className="h-4 w-4 transition-transform duration-200" style={{ transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)' }} />
        </div>
      </div>

      {isOpen && (
        <div className="absolute z-50 mt-1.5 max-h-56 w-full overflow-y-auto rounded-xl border border-white/10 bg-[#0F1115] py-1 shadow-2xl backdrop-blur-lg animate-fade-in-up">
          {filteredOptions.length > 0 ? (
            filteredOptions.map((option, idx) => (
              <button
                key={idx}
                type="button"
                onClick={() => handleSelect(option)}
                className={cx(
                  "w-full px-3.5 py-2.5 text-left text-xs transition-colors hover:bg-white/[0.03]",
                  option === value ? "text-[#C6A66B] font-bold" : "text-slate-350 hover:text-white"
                )}
              >
                {option}
              </button>
            ))
          ) : (
            <div className="px-3.5 py-2.5 text-xs text-slate-500 font-medium italic">
              No matching team members found
            </div>
          )}
        </div>
      )}
    </div>
  );
}
