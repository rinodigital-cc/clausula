"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export function NavTabs({ items, label = "Principal" }: { items: { href: string; label: string; exact?: boolean }[]; label?: string }) {
  const path = usePathname();
  return (
    <nav aria-label={label} className="nav-tabs">
      {items.map((i) => {
        const active = i.exact ? path === i.href || path.startsWith("/app/consulta") : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}>
            {i.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function SideNav({ items }: { items: { href: string; label: string; icon: React.ReactNode; count?: number; exact?: boolean }[] }) {
  const path = usePathname();
  return (
    <nav aria-label="Administração" className="side-nav">
      {items.map((i) => {
        const active = i.exact ? path === i.href : path.startsWith(i.href);
        return (
          <Link key={i.href} href={i.href} aria-current={active ? "page" : undefined}>
            {i.icon}
            <span>{i.label}</span>
            {i.count ? <span className="count" aria-label={`${i.count} pendentes`}>{i.count}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}
