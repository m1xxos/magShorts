"use client";

// The one switch.
//
// There were four copies of this markup — the sidebar's feed row, the settings
// dialog's folder list, and twice inline in Manage sources — which is how the
// app ended up with a control that is 32×18 everywhere and 44px nowhere. The
// touch size lives in the class string rather than a `size` prop so a call site
// cannot forget it.
export function Switch({
  checked,
  title,
  onClick,
  label,
}: {
  checked: boolean;
  title: string;
  onClick: () => void;
  // The word beside it. A switch with no visible state word reads as decoration
  // in a row that already carries chips.
  label?: string;
}) {
  const button = (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label ? undefined : title}
      title={title}
      onClick={onClick}
      className={`relative h-[18px] w-8 shrink-0 rounded-full transition-colors pointer-coarse:h-[31px] pointer-coarse:w-[51px] ${
        checked ? "bg-clay" : "bg-line"
      }`}
    >
      <span
        className={`absolute top-[2px] h-[14px] w-[14px] rounded-full bg-white shadow-sm transition-all pointer-coarse:h-[27px] pointer-coarse:w-[27px] ${
          checked
            ? "left-[16px] pointer-coarse:left-[22px]"
            : "left-[2px] pointer-coarse:left-[2px]"
        }`}
      />
    </button>
  );

  if (!label) return button;
  return (
    <span className="flex shrink-0 items-center gap-2">
      {button}
      <span
        className={`w-6 text-[12px] pointer-coarse:text-[13.5px] ${
          checked ? "text-ink-soft" : "text-ink-faint"
        }`}
      >
        {label}
      </span>
    </span>
  );
}
