"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { Database, LayoutDashboard, FlaskConical, KanbanSquare, LineChart, LogOut, Newspaper } from "lucide-react"
import { useTaskGroups, useWorkspace } from "@/lib/workspace"
import { dateShort } from "@/lib/format"
import { handleSignOut } from "@/app/actions"

export const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/taken", label: "Mijn taken", icon: KanbanSquare },
  { href: "/analyses", label: "SEO-analyses", icon: LineChart },
  { href: "/experimenten", label: "Experimenten", icon: FlaskConical },
] as const

export const CONTENT_NAV = [
  { href: "/content", label: "Contentkansen", icon: Newspaper },
] as const

const SYSTEM_NAV = [
  { href: "/data", label: "Datastatus", icon: Database },
] as const

export default function Sidebar({ user }: { user: { name?: string | null; email?: string | null; image?: string | null } }) {
  const pathname = usePathname()
  const { loading, dataUntil } = useWorkspace()
  const { toReview, evaluating } = useTaskGroups()
  const [contentNew, setContentNew] = useState(0)
  useEffect(() => {
    fetch("/api/content?count=1", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => setContentNew(j?.nieuw || 0)).catch(() => {})
  }, [pathname])
  const counts: Record<string, number> = {
    "/taken": loading ? 0 : toReview.length,
    "/experimenten": loading ? 0 : evaluating.length,
    "/content": contentNew,
  }
  const first = user.name?.split(" ")[0] || "Jij"

  return (
    <aside className="sidebar" aria-label="Hoofdnavigatie">
      <Link href="/" className="sidebar-brand" aria-label="Gijs Intelligence, naar het Dashboard">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-gijs.png" alt="Gijs" width={53} height={30} />
        <span className="sidebar-brand-text"><strong>Intelligence</strong><span>SEO en content</span></span>
      </Link>

      <nav>
        {([["SEO", NAV], ["Content", CONTENT_NAV], ["Systeem", SYSTEM_NAV]] as const).map(([label, items]) => (
          <div key={label} className="nav-group">
            <p className="nav-label eyebrow">{label}</p>
            <ul className="sidebar-nav">
              {items.map(item => {
                const active = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)
                const Icon = item.icon
                const count = counts[item.href]
                return (
                  <li key={item.href}>
                    <Link href={item.href} className={`nav-link${active ? " is-active" : ""}`} aria-current={active ? "page" : undefined} title={item.label}>
                      <Icon aria-hidden />
                      <span>{item.label}</span>
                      {count ? <em className="nav-count" style={{ fontStyle: "normal" }} aria-label={`${count} openstaand`}>{count}</em> : null}
                    </Link>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="data-note">
          <strong>Search Console</strong>
          {dataUntil ? <>Gegevens tot en met {dateShort(dataUntil)}. Google loopt ±2 dagen achter.</> : "Gegevens worden geladen…"}
        </div>
        <div className="user-chip">
          <span className="avatar" aria-hidden>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {user.image ? <img src={user.image} alt="" referrerPolicy="no-referrer" /> : first[0]?.toUpperCase()}
          </span>
          <span className="user-chip-text">
            <strong className="truncate">{user.name || first}</strong>
            <span className="truncate">{user.email}</span>
          </span>
          <form action={handleSignOut} style={{ marginLeft: "auto" }}>
            <button type="submit" className="icon-btn" title="Uitloggen" aria-label="Uitloggen"><LogOut /></button>
          </form>
        </div>
      </div>
    </aside>
  )
}
