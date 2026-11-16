"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { CalendarCheck, Database, FlaskConical, KanbanSquare, LineChart, LogOut } from "lucide-react"
import { useTaskGroups, useWorkspace } from "@/lib/workspace"
import { dateShort } from "@/lib/format"
import { handleSignOut } from "@/app/actions"

export const NAV = [
  { href: "/", label: "Vandaag", icon: CalendarCheck },
  { href: "/taken", label: "Mijn taken", icon: KanbanSquare },
  { href: "/analyses", label: "SEO-analyses", icon: LineChart },
  { href: "/experimenten", label: "Experimenten", icon: FlaskConical },
  { href: "/data", label: "Datastatus", icon: Database },
] as const

export default function Sidebar({ user }: { user: { name?: string | null; email?: string | null; image?: string | null } }) {
  const pathname = usePathname()
  const { loading, dataUntil } = useWorkspace()
  const { toReview, evaluating } = useTaskGroups()
  const counts: Record<string, number> = {
    "/taken": loading ? 0 : toReview.length,
    "/experimenten": loading ? 0 : evaluating.length,
  }
  const first = user.name?.split(" ")[0] || "Jij"

  return (
    <aside className="sidebar" aria-label="Hoofdnavigatie">
      <Link href="/" className="sidebar-brand" aria-label="Gijs Intelligence, naar Vandaag">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-gijs.png" alt="Gijs" width={53} height={30} />
        <span className="sidebar-brand-text"><strong>Intelligence</strong><span>SEO-werkruimte</span></span>
      </Link>

      <nav>
        <p className="nav-label eyebrow">Werkruimte</p>
        <ul className="sidebar-nav">
          {NAV.map(item => {
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
