"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "./Logo";

// Icons matter on the phone: the rail becomes a bottom tab bar there, and a
// text-only tab bar is hard to scan at a glance.
const ITEMS = [
  {
    href: "/dashboard",
    label: "Queue",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <rect x="2.5" y="2.5" width="6.5" height="6.5" rx="1.4" />
        <rect x="11" y="2.5" width="6.5" height="6.5" rx="1.4" />
        <rect x="2.5" y="11" width="6.5" height="6.5" rx="1.4" />
        <rect x="11" y="11" width="6.5" height="6.5" rx="1.4" />
      </svg>
    ),
  },
  {
    href: "/connectors",
    label: "Connectors",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <path d="M7.5 12.5 4.9 15.1a3 3 0 0 1-4.2-4.2l2.6-2.6" />
        <path d="M12.5 7.5l2.6-2.6a3 3 0 0 1 4.2 4.2l-2.6 2.6" />
        <path d="M7.2 12.8l5.6-5.6" />
      </svg>
    ),
  },
  {
    href: "/settings",
    label: "Settings",
    icon: (
      <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.6">
        <circle cx="10" cy="10" r="2.6" />
        <path d="M10 1.8v2M10 16.2v2M18.2 10h-2M3.8 10h-2M15.8 4.2l-1.4 1.4M5.6 14.4l-1.4 1.4M15.8 15.8l-1.4-1.4M5.6 5.6 4.2 4.2" />
      </svg>
    ),
  },
];

export function NavRail() {
  const pathname = usePathname();
  return (
    <nav className="rail">
      <div className="wordmark">
        <Logo size={24} />
        <span className="mark">SnipAi</span>
      </div>
      <div className="nav">
        {ITEMS.map((item) => (
          <Link key={item.href} href={item.href} className={pathname.startsWith(item.href) ? "active" : ""}>
            {item.icon}
            {item.label}
          </Link>
        ))}
      </div>
      <div className="rail-foot">
        <div className="who">
          <div className="avatar">KA</div>
          <div>
            <div className="name">Kayer</div>
            <div className="role">Arzacorp</div>
          </div>
        </div>
      </div>
    </nav>
  );
}
