"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { useEffect, useState } from "react"
import { BookOpenCheck, CalendarCheck, Compass, Database, FileBarChart, LayoutDashboard, FlaskConical, KanbanSquare, LineChart, LogOut, Newspaper, MessageSquare, Mail, MoreHorizontal, Target } from "lucide-react"
import { useTaskGroups, useWorkspace } from "@/lib/workspace"
import { dateShort } from "@/lib/format"
import { handleSignOut } from "@/app/actions"

// Drie groepen (docs/DESIGN.md): wat je dagelijks doet, waar je de diepte in gaat, en beheer
export const DAILY_NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/vandaag", label: "Vandaag", icon: CalendarCheck },
  { href: "/taken", label: "Mijn taken", icon: KanbanSquare },
] as const

export const DEEP_NAV = [
  { href: "/advies", label: "Siteadvies", icon: Compass },
  { href: "/seo-kansen", label: "SEO-kansen", icon: Target },
  { href: "/analyses", label: "SEO-analyses", icon: LineChart },
  { href: "/content", label: "Contentkansen", icon: Newspaper },
  { href: "/campagnes", label: "Offline campagnes", icon: Mail },
  { href: "/experimenten", label: "Experimenten", icon: FlaskConical },
  { href: "/geleerd", label: "Lessen", icon: BookOpenCheck },
  { href: "/rapporten", label: "Vrijdagrapport", icon: FileBarChart },
] as const

const ADMIN_NAV = [
  { href: "/data", label: "Datastatus", icon: Database },
  { href: "/koppeling", label: "Claude-koppeling", icon: MessageSquare },
] as const

const GROUPS = [["Dagelijks", DAILY_NAV], ["Verdieping", DEEP_NAV], ["Beheer", ADMIN_NAV]] as const

export default function Sidebar({ user }: { user: { name?: string | null; email?: string | null; image?: string | null } }) {
  const pathname = usePathname()
  const { loading, dataUntil } = useWorkspace()
  const [more, setMore] = useState(false)
  useEffect(() => { setMore(false) }, [pathname])
  const { toReview, evaluating } = useTaskGroups()
  const [contentNew, setContentNew] = useState(0)
  useEffect(() => {
    fetch("/api/content?count=1", { cache: "no-store" }).then(r => (r.ok ? r.json() : null)).then(j => setContentNew(j?.nieuw || 0)).catch(() => {})
  }, [pathname])
  const counts: Record<string, number> = {
    // Mijn taken = SEO-adviezen én contentkansen die op beoordeling wachten (zelfde telling als de kolom op het bord)
    "/taken": loading ? 0 : toReview.length + contentNew,
    // Vandaag: hoge prioriteit plus herinneringen die vandaag (of eerder) terugkomen
    "/vandaag": loading ? 0 : toReview.filter(t => t.signal.priority === "hoog" || t.signal.reminder).length,
    "/seo-kansen": loading ? 0 : toReview.filter(t => !t.signal.reminder).length,
    "/content": contentNew,
  }
  const first = user.name?.split(" ")[0] || "Jij"
  const renderGroup = ([label, items]: (typeof GROUPS)[number]) => (
    <div key={label} className={`nav-group nav-group-${label.toLowerCase()}`}>
      <p className="nav-label">{label}</p>
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
  )

  return (
    <aside className="sidebar" aria-label="Hoofdnavigatie">
      <Link href="/" className="sidebar-brand" aria-label="Gijs Intelligence, naar het Dashboard">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/logo-gijs.png" alt="Gijs" width={53} height={30} />
        <span className="sidebar-brand-text"><strong>Intelligence</strong><span>SEO en content</span></span>
      </Link>

      <nav className={more ? "is-more" : undefined}>
        {renderGroup(GROUPS[0])}
        <div className="nav-rest">{GROUPS.slice(1).map(renderGroup)}</div>
        {/* Op de telefoon: alleen Dagelijks in de balk, de rest onder Meer */}
        <button type="button" className="nav-link nav-more" aria-expanded={more} onClick={() => setMore(m => !m)} title="Meer pagina's">
          <MoreHorizontal aria-hidden /><span>Meer</span>
        </button>
      </nav>

      <div className="sidebar-foot">
        <p className="data-note">{dataUntil ? <>Search Console t/m {dateShort(dataUntil)}</> : "Gegevens laden…"}</p>
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
