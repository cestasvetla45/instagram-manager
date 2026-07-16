"use client";
import { useId } from "react";

// A niche picker that lets you either choose an existing niche OR type a new one.
// Typing something new and committing (Enter / blur) creates it in the niches
// table via POST /api/niches, then calls onCreate so the parent can refresh.
export default function NicheCombo({
  value,
  onChange,
  niches,
  placeholder = "niche…",
  onCreate,
  onCommit,
  style,
  disabled,
}: {
  value: string;
  onChange: (v: string) => void;
  niches: string[];
  placeholder?: string;
  onCreate?: (name: string) => void;
  onCommit?: (v: string) => void;
  style?: React.CSSProperties;
  disabled?: boolean;
}) {
  const listId = useId();

  async function commit(v: string) {
    const name = v.trim();
    onChange(name);
    onCommit?.(name);
    if (!name) return;
    if (niches.some((n) => n.toLowerCase() === name.toLowerCase())) return;
    try {
      await fetch("/api/niches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      onCreate?.(name);
    } catch {
      /* niche will still be applied where it's used */
    }
  }

  return (
    <>
      <input
        list={listId}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit((e.target as HTMLInputElement).value);
          }
        }}
        style={style}
      />
      <datalist id={listId}>
        {niches.map((n) => (
          <option key={n} value={n} />
        ))}
      </datalist>
    </>
  );
}
