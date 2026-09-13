"use client";

import { useEffect, useRef, useState } from "react";

interface CityMatch {
  name: string;
  where: string;
}

// The city box, with suggestions.
//
// A combobox rather than a select, because the list of places people live is
// not a list you can put in a dropdown. It stays a text field underneath: the
// suggestions come from a service that can be slow, blocked or simply unaware
// of a town of forty thousand, and in every one of those cases typing the name
// has to keep working.
export function CityField({
  value,
  onChange,
  label,
  hint,
}: {
  value: string;
  onChange: (value: string) => void;
  label: string;
  hint: string;
}) {
  const [matches, setMatches] = useState<CityMatch[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  // What the suggestions on screen are for. Without it a slow answer to "сан"
  // lands under a box that now reads "санкт-петербург".
  const [askedFor, setAskedFor] = useState("");
  // Set when a suggestion is taken, so choosing one does not immediately ask
  // for suggestions for the name just chosen.
  const chosen = useRef("");
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const query = value.trim();
    if (query.length < 3 || query === chosen.current) {
      setMatches([]);
      return;
    }
    // Nominatim asks for no more than a request a second, and a keystroke is
    // faster than that.
    const timer = setTimeout(() => {
      fetch(`/api/city/lookup?q=${encodeURIComponent(query)}`)
        .then((response) => (response.ok ? response.json() : []))
        .catch(() => [])
        .then((rows: CityMatch[]) => {
          setMatches(Array.isArray(rows) ? rows : []);
          setAskedFor(query);
          setActive(-1);
        });
    }, 450);
    return () => clearTimeout(timer);
  }, [value]);

  // A click anywhere else is a decision not to pick one.
  useEffect(() => {
    function onDown(event: MouseEvent) {
      if (!box.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  function take(match: CityMatch) {
    chosen.current = match.name;
    onChange(match.name);
    setMatches([]);
    setOpen(false);
  }

  const showing = open && matches.length > 0 && askedFor === value.trim();

  return (
    <div ref={box} className="relative block">
      <label className="block">
        <span className="text-[13px] font-medium text-ink-soft">{label}</span>
        <input
          value={value}
          onChange={(event) => {
            chosen.current = "";
            onChange(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={(event) => {
            if (!showing) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActive((index) => Math.min(index + 1, matches.length - 1));
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActive((index) => Math.max(index - 1, -1));
            } else if (event.key === "Enter" && active >= 0) {
              // Only when one is highlighted: Enter on a name you typed
              // yourself should submit the form, not pick a suggestion.
              event.preventDefault();
              take(matches[active]);
            } else if (event.key === "Escape") {
              setOpen(false);
            }
          }}
          role="combobox"
          aria-expanded={showing}
          aria-controls="city-suggestions"
          aria-autocomplete="list"
          autoComplete="off"
          placeholder="Санкт-Петербург"
          className="mt-1.5 w-full rounded-xl border border-line bg-paper px-4 py-2.5 text-sm text-ink outline-none placeholder:text-ink-faint focus:border-clay pointer-coarse:py-3 pointer-coarse:text-[15.5px]"
        />
        <span className="mt-1 block text-[12px] text-ink-faint pointer-coarse:text-[13.5px]">
          {hint}
        </span>
      </label>

      {showing && (
        <ul
          id="city-suggestions"
          role="listbox"
          className="absolute z-10 mt-1 max-h-64 w-full overflow-auto rounded-xl border border-line bg-paper-raised py-1 shadow-lg"
        >
          {matches.map((match, index) => (
            <li key={`${match.name}-${match.where}`}>
              <button
                type="button"
                role="option"
                aria-selected={index === active}
                onMouseEnter={() => setActive(index)}
                onClick={() => take(match)}
                className={`block w-full px-4 py-2 text-left transition ${
                  index === active ? "bg-line/60" : ""
                }`}
              >
                <span className="block text-sm text-ink">{match.name}</span>
                {match.where && (
                  <span className="block truncate text-[12px] text-ink-faint">
                    {match.where}
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
