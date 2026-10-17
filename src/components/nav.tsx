"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const LINKS = [
  { href: "/dashboard", label: "Command Center" },
  { href: "/missions", label: "Missions" },
  { href: "/habits", label: "Habits" },
  { href: "/quests", label: "Quests" },
  { href: "/review", label: "Day review" },
  { href: "/settings", label: "Settings" },
] as const;

function NavLinks({ compact = false }: { compact?: boolean }) {
  const pathname = usePathname();
  return (
    <nav className="nav" aria-label="Main navigation">
      {LINKS.map((link) => {
        const current = pathname === link.href || pathname.startsWith(`${link.href}/`);
        return (
          <Link
            key={link.href}
            href={link.href}
            className="nav-link"
            aria-current={current ? "page" : undefined}
            title={compact ? link.label : undefined}
          >
            {link.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SidebarNav() {
  return (
    <aside className="sidebar">
      <Link href="/dashboard" className="brand" aria-label="LEVI OS home">
        <span className="brand-mark" aria-hidden="true">
          L
        </span>
        LEVI OS
      </Link>
      <NavLinks />
      <div className="stack-sm muted" style={{ fontSize: "0.8rem" }}>
        <p className="faint">Progress is derived from completed, evidenced work.</p>
        <form action="/auth/signout" method="post">
          <button className="button ghost tiny" type="submit">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}

export function MobileNav() {
  return (
    <div className="mobile-nav">
      <NavLinks compact />
    </div>
  );
}
