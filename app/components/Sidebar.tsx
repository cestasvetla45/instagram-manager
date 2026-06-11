"use client";
import { usePathname } from "next/navigation";
import Link from "next/link";

const links = [
  { href: "/", label: "Overview" },
  { href: "/add", label: "Add / Scrape" },
  { href: "/inspiration", label: "Inspiration Reels" },
  { href: "/accounts", label: "Accounts" },
  { href: "/our-reels", label: "Our Reels" },
  { href: "/analytics", label: "Analytics" },
];

export default function Sidebar() {
  const path = usePathname();
  return (
    <aside className="sidebar">
      <div className="brand">Reel Lab</div>
      <div className="brand-sub">Instagram manager</div>
      <nav className="nav">
        {links.map((l) => (
          <Link key={l.href} href={l.href} className={path === l.href ? "active" : ""}>
            {l.label}
          </Link>
        ))}
      </nav>
    </aside>
  );
}
