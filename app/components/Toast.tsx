"use client";
import { useCallback, useRef, useState } from "react";

export type ToastItem = { id: number; text: string; kind: "ok" | "error" };

// Minimal toast — reuses the app's existing `.banner` / `.banner.ok` colors
// (see globals.css) so it matches the inline-message pattern every other
// page already uses, just as a floating auto-dismissing stack instead of a
// static block. Pair with useToast()'s push() for optimistic-update feedback.
export function useToast() {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idRef = useRef(0);
  const push = useCallback((text: string, kind: "ok" | "error" = "ok") => {
    const id = ++idRef.current;
    setToasts((prev) => [...prev, { id, text, kind }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 3500);
  }, []);
  return { toasts, push };
}

export default function Toast({ toasts }: { toasts: ToastItem[] }) {
  if (!toasts.length) return null;
  return (
    <div style={{ position: "fixed", bottom: 20, right: 20, zIndex: 200, display: "flex", flexDirection: "column", gap: 8 }}>
      {toasts.map((t) => (
        <div
          key={t.id}
          className="banner"
          style={{
            margin: 0,
            minWidth: 220,
            maxWidth: 360,
            background: t.kind === "error" ? "#2a1622" : "#16241a",
            borderColor: t.kind === "error" ? "var(--accent)" : "var(--good)",
            color: t.kind === "error" ? "#ffd5e2" : "#c9f7d8",
            boxShadow: "0 6px 18px rgba(0,0,0,.35)",
          }}
        >
          {t.text}
        </div>
      ))}
    </div>
  );
}
