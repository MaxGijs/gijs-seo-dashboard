"use client"

// Vandaag in de nieuwe opmaak (shadcn/ui + Tailwind). Zelfde gegevens en acties als de huidige pagina;
// alleen de opbouw is rustiger: één samenvattende zin, één statusstrook, per onderwerp één vlak.

import Link from "next/link"
import { useMemo, useState } from "react"
import { useRouter } from "next/navigation"
import { BellRing, CalendarClock, CalendarPlus, Check, CheckCircle2, CircleAlert, ExternalLink, Eye, LineChart, ListTodo, Newspaper, Play, Plus, RefreshCw } from "lucide-react"
import { useTaskGroups, useWorkspace } from "@/lib/workspace"
import { useContentIdeas } from "@/lib/content/useContent"
import { useAlerts } from "@/components/dashboard/Alerts"
import { useMeasureUpdates } from "@/lib/measureUpdates"
import { usePageFeed } from "@/lib/pageFeed"
import { openRefreshes, REFRESH_META } from "@/lib/content/refresh"
import { EVENT_META } from "@/lib/watch"
import type { Experiment, Task } from "@/lib/types"
import { KIND_META } from "@/lib/workflow"
import { addDays, dateLong, dateShort, gainShort, greeting, num, signedPct, today } from "@/lib/format"
import { cn } from "@/lib/utils"
import { Button, buttonVariants } from "./ui/button"
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "./ui/card"
import { Badge } from "./ui/badge"
import ReminderDialog from "@/components/reminders/ReminderDialog"
import { PageHeader } from "@/components/ui"
import AddTaskDialog from "@/components/views/AddTaskDialog"

function nextMeasurement(e: Experiment) {
  const steps: [number, keyof Experiment][] = [[14, "result_14d"], [28, "result_28d"], [56, "result_56d"]]
  for (const [d, k] of steps) if (!e[k]) return { days: d, date: addDays(e.changed_at, d) }
  return null
}
const subject = (t: Task) => (t.signal.query ? `"${t.signal.query}"` : t.signal.headline)
const kindLabel = (t: Task) => (t.signal.reminder ? "Herinnering" : KIND_META[t.signal.kind].label)
const PRIO: Record<string, { label: string; dot: string }> = {
  hoog: { label: "Hoog", dot: "bg-accent" }, middel: { label: "Middel", dot: "bg-subtle" }, laag: { label: "Laag", dot: "bg-line" },
}

export default function TodayV2() {
  const { user, loading, overview, prevOverview, tasks, experiments, openTask, users } = useWorkspace()
  const { toReview, active, evaluating } = useTaskGroups()
  const content = useContentIdeas()
  const { d: alerts } = useAlerts()
  const updates = useMeasureUpdates(tasks, content.ideas)
  const feed = usePageFeed()
  const refreshes = useMemo(() => openRefreshes(content.ideas || []), [content.ideas])
  const lostPages = feed.items.filter(e => e.event === "uit-index")
  const router = useRouter()
  const [adding, setAdding] = useState(false)
  const [reminding, setReminding] = useState(false)
  const first = user.name?.split(" ")[0] || ""

  const clicks = overview.reduce((s, r) => s + r.clicks, 0), prevClicks = prevOverview.reduce((s, r) => s + r.clicks, 0)
  const impressions = overview.reduce((s, r) => s + r.impressions, 0)
  const clickDelta = prevClicks ? ((clicks - prevClicks) / prevClicks) * 100 : null
  const focus = toReview.filter(t => t.signal.intent !== "merk" && !t.signal.reminder).slice(0, 5)
  const focusHigh = focus.filter(t => t.signal.priority === "hoog").length
  const highCount = toReview.filter(t => t.signal.priority === "hoog" && !t.signal.reminder).length
  const inProgress = active.filter(t => t.status === "in_uitvoering").length
  const contentNew = (content.ideas || []).filter(i => i.status === "nieuw").length
  const reminders = tasks.filter(t => t.signal.reminder && t.status === "uitgesteld")
  const due = reminders.filter(t => !t.snoozed).sort((a, b) => (a.snoozeUntil || "").localeCompare(b.snoozeUntil || ""))
  const upcoming = reminders.filter(t => t.snoozed).sort((a, b) => (a.snoozeUntil || "").localeCompare(b.snoozeUntil || ""))
  const openAlerts = (alerts?.alerts || []).filter(a => !a.resolved_at)

  const measurements = useMemo(() => {
    const byKey = new Map(tasks.map(t => [t.key, t]))
    return experiments
      .map(e => ({ e, next: nextMeasurement(e), task: byKey.get(e.advice_key) }))
      .filter(x => x.task && (x.next || x.e.outcome))
      .sort((a, b) => ((a.next?.date || "9999") < (b.next?.date || "9999") ? -1 : 1))
      .slice(0, 5)
  }, [experiments, tasks])
  const nextDue = measurements.find(m => m.next)?.next

  // De dag in één zin: wat vraagt er vandaag echt iets van je?
  const summary = loading ? "" : (() => {
    const parts: string[] = []
    if (due.length) parts.push(`${due.length} ${due.length === 1 ? "herinnering" : "herinneringen"}`)
    if (highCount) parts.push(`${highCount} ${highCount === 1 ? "advies" : "adviezen"} met hoge prioriteit`)
    if (openAlerts.length) parts.push(`${openAlerts.length} ${openAlerts.length === 1 ? "melding" : "meldingen"}`)
    if (refreshes.length) parts.push(`${refreshes.length} ${refreshes.length === 1 ? "pagina die een refresh nodig heeft" : "pagina's die een refresh nodig hebben"}`)
    if (lostPages.length) parts.push(`${lostPages.length} ${lostPages.length === 1 ? "pagina die uit Google verdween" : "pagina's die uit Google verdwenen"}`)
    if (parts.length) return `Vandaag vragen ${parts.length > 1 ? parts.slice(0, -1).join(", ") + " en " + parts[parts.length - 1] : parts[0]} je aandacht.`
    if (active.length) return `Niets dringends. Werk verder aan je ${active.length} lopende ${active.length === 1 ? "taak" : "taken"}.`
    return toReview.length ? "Niets dringends. Er liggen adviezen klaar om te beoordelen." : "Alles is beoordeeld. Nieuwe data komt elke nacht binnen."
  })()
  const who = (email?: string | null) => (email ? users.find(u => u.email === email)?.name?.split(" ")[0] || email.split("@")[0] : "iedereen")

  return (
    <div className="v2 font-sans text-ink">
      {/* Kop: wat zie ik, is het goed, wat doe ik nu (zie docs/DESIGN.md) */}
      <PageHeader title="Vandaag"
        status={loading ? null : { tone: due.length || highCount || openAlerts.length || refreshes.length || lostPages.length ? "attention" : "good", text: summary }}
        sub={<>{greeting()}{first ? `, ${first}` : ""}. Het is {dateLong(today())}.{!loading && overview.length > 0 && <> Laatste 28 dagen: <b>{num(clicks)}</b> klikken{clickDelta !== null && <> ({signedPct(clickDelta)})</>} en <b>{num(impressions)}</b> vertoningen in Google.</>}</>}
        actions={<>
          <Button variant="outline" size="sm" onClick={() => setReminding(true)}><BellRing />Herinnering</Button>
          <Button size="sm" onClick={() => setAdding(true)}><Plus />Taak toevoegen</Button>
        </>} />

      {/* Herinneringen voor vandaag: bovenaan en opvallend, want ze komen precies op deze dag terug */}
      {due.length > 0 && (
        <section aria-labelledby="v2-nu" className="mb-6 overflow-hidden rounded-panel border border-amber/35 bg-amber-soft">
          <h2 id="v2-nu" className="flex items-center gap-2 px-5 pt-4 pb-3 text-[15px] font-semibold text-amber">
            <BellRing className="size-4" />{due.length === 1 ? "Herinnering voor vandaag" : `${due.length} herinneringen voor vandaag`}
          </h2>
          <ul className="flex flex-col gap-2 px-3 pb-3">{due.map(t => <DueReminder key={t.key} t={t} owner={t.owner ? who(t.owner) : null} />)}</ul>
        </section>
      )}

      {/* Statusstrook: vier getallen in één vlak */}
      <Card className="mb-6 grid grid-cols-2 overflow-hidden lg:grid-cols-4">
        {[
          { href: "/taken", label: "Te beoordelen", value: toReview.filter(t => !t.signal.reminder).length + contentNew, foot: `${highCount} hoge prioriteit${contentNew ? `, ${contentNew} contentkansen` : ""}` },
          { href: "/taken", label: "Lopend werk", value: active.length, foot: active.length ? [inProgress && `${inProgress} in uitvoering`, active.length - inProgress && `${active.length - inProgress} gepland`].filter(Boolean).join(", ") : "Nog niets ingepland" },
          { href: "/experimenten", label: "Wordt gemeten", value: evaluating.length, foot: nextDue ? `Volgende meting ${dateShort(nextDue.date)}` : "Nog geen lopende metingen" },
          { href: "/analyses", label: "Klikken uit Google", value: clicks, foot: clickDelta !== null ? `${signedPct(clickDelta)} t.o.v. de 28 dagen ervoor` : "Laatste 28 dagen" },
        ].map((s, i) => (
          <Link key={s.label} href={s.href} className={cn("group block px-5 py-4 outline-none transition-colors hover:bg-canvas focus-visible:bg-accent-soft", i % 2 === 1 && "border-l border-line-soft", i >= 2 && "border-t border-line-soft lg:border-t-0", i === 2 && "lg:border-l")}>
            <span className="block text-xs font-semibold text-muted">{s.label}</span>
            <span className="mt-1 block text-[26px] font-bold leading-none tabular-nums text-heading">{loading ? "–" : num(s.value)}</span>
            <span className="mt-2 block text-xs text-subtle lg:truncate">{loading ? " " : s.foot}</span>
          </Link>
        ))}
      </Card>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex min-w-0 flex-col gap-6 lg:col-span-2">
          {/* Vandaag doen: echte volgorde, dus genummerd */}
          <Card aria-labelledby="v2-doen">
            <CardHeader>
              <div>
                <CardTitle id="v2-doen">Vandaag doen</CardTitle>
                <CardDescription>Op volgorde: technische blokkades eerst, daarna de meeste verwachte winst.</CardDescription>
              </div>
              {!loading && focusHigh > 0 && <Badge variant="accent" className="shrink-0 text-xs">{focusHigh} met hoge prioriteit</Badge>}
            </CardHeader>
            {loading ? <CardContent><div className="h-40 animate-pulse rounded-control bg-canvas" /></CardContent> : focus.length === 0 ? (
              <CardContent><p className="flex items-center gap-2 text-[13px] text-muted"><CheckCircle2 className="size-4 text-accent" />Alles is beoordeeld. Nieuwe adviezen komen elke nacht binnen.</p></CardContent>
            ) : (
              <ol className="divide-y divide-line-soft border-t border-line-soft">
                {focus.map((t, i) => { const high = t.signal.priority === "hoog"; return (
                  <li key={t.key} className={cn(high && "relative bg-accent-soft/60 before:absolute before:inset-y-0 before:left-0 before:w-[3px] before:bg-accent")} data-prio={t.signal.priority}>
                    <button onClick={() => openTask(t.key)} className={cn("grid w-full cursor-pointer grid-cols-[1.75rem_minmax(0,1fr)] items-start sm:grid-cols-[1.75rem_minmax(0,1fr)_auto] gap-x-3 px-5 text-left outline-none transition-colors focus-visible:bg-accent-soft", high ? "py-3.5 hover:bg-accent-soft" : "py-3 hover:bg-canvas")}>
                      <span className={cn("pt-0.5 text-[13px] font-semibold tabular-nums", high ? "text-accent" : "text-subtle")}>{i + 1}</span>
                      <span className="min-w-0">
                        <span className="block text-xs text-muted">{kindLabel(t)}</span>
                        <span className={cn("block truncate font-semibold text-heading", high ? "text-[15px]" : "text-sm")}>{subject(t)}</span>
                        <span className="mt-0.5 block truncate text-[13px] text-muted">{t.signal.action || t.signal.title}</span>
                      </span>
                      <span className="col-start-2 mt-1 flex items-center gap-3 sm:col-start-auto sm:mt-0 sm:flex-col sm:items-end sm:gap-1 sm:pt-0.5">
                        {high
                          ? <span className="inline-flex items-center rounded-full bg-accent px-2 py-0.5 text-[11px] font-semibold text-white">Hoge prioriteit</span>
                          : <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-ink"><span className={cn("size-2 rounded-full", PRIO[t.signal.priority].dot)} />{PRIO[t.signal.priority].label}</span>}
                        <span className="text-xs whitespace-nowrap text-subtle">{gainShort(t.signal.gain)}</span>
                      </span>
                    </button>
                  </li>
                ) })}
              </ol>
            )}
            <CardFooter className="justify-between text-[13px]">
              <span className="text-muted">{loading ? "" : `${toReview.filter(t => !t.signal.reminder).length} adviezen te beoordelen${contentNew ? `, plus ${contentNew} contentkansen` : ""}`}</span>
              <Link href="/taken" className={buttonVariants({ variant: "link", size: "sm" })}>Naar Mijn taken</Link>
            </CardFooter>
          </Card>

          {/* Lopend werk */}
          {/* Pagina's die een refresh nodig hebben: blijven staan tot iemand ze behandelt */}
          {!loading && refreshes.length > 0 && (
            <Card aria-labelledby="v2-refresh" className="border-amber/35">
              <CardHeader>
                <div>
                  <CardTitle id="v2-refresh" className="flex items-center gap-2"><RefreshCw className="size-4 text-amber" />Refresh nodig</CardTitle>
                  <CardDescription>Inhoud die verouderd is of minder goed scoort. Blijft staan tot je hem bijwerkt of afwijst.</CardDescription>
                </div>
              </CardHeader>
              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {refreshes.slice(0, 5).map(r => (
                  <li key={r.id} data-refresh={r.kind}>
                    <button onClick={() => router.push(`/content/${r.id}?van=vandaag`)} className="grid w-full cursor-pointer grid-cols-[minmax(0,1fr)_auto] items-start gap-x-3 px-5 py-3 text-left outline-none transition-colors hover:bg-canvas focus-visible:bg-accent-soft">
                      <span className="min-w-0">
                        <span className="block text-xs text-muted">{REFRESH_META[r.kind].label}{r.page ? ` · ${r.page}` : ""}</span>
                        <span className="block truncate text-sm font-semibold text-heading">{r.title}</span>
                      </span>
                      <span className="text-xs whitespace-nowrap text-subtle">sinds {dateShort(r.created_at)}</span>
                    </button>
                  </li>
                ))}
              </ul>
              <CardFooter className="justify-between text-[13px]">
                <span className="text-muted">{refreshes.length > 5 ? `En nog ${refreshes.length - 5}.` : ""}</span>
                <Link href="/content" className={buttonVariants({ variant: "link", size: "sm" })}>Naar Contentkansen</Link>
              </CardFooter>
            </Card>
          )}

          <Card aria-labelledby="v2-lopend">
            <CardHeader>
              <div>
                <CardTitle id="v2-lopend">Lopend werk</CardTitle>
                <CardDescription>Ingepland of in uitvoering. Zet een taak op uitgevoerd zodra het staat; dan start de meting.</CardDescription>
              </div>
            </CardHeader>
            {active.length === 0 ? (
              <CardContent><p className="text-[13px] text-muted">Nog niets ingepland. Kies hierboven een advies en plan het in.</p></CardContent>
            ) : (
              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {active.slice(0, 6).map(t => (
                  <li key={t.key}>
                    <button onClick={() => openTask(t.key)} className="grid w-full cursor-pointer grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-3 px-5 py-2.5 text-left outline-none transition-colors hover:bg-canvas focus-visible:bg-accent-soft">
                      {t.status === "in_uitvoering" ? <Play className="size-4 text-accent" aria-label="In uitvoering" /> : <CalendarClock className="size-4 text-subtle" aria-label="Gepland" />}
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-semibold text-heading">{subject(t)}</span>
                        <span className="block truncate text-xs text-muted">{t.signal.action || t.signal.title}</span>
                      </span>
                      <span className="text-xs whitespace-nowrap text-subtle">{t.status === "in_uitvoering" ? "In uitvoering" : "Gepland"}{t.owner ? `, ${who(t.owner)}` : ""}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {active.length > 6 && <CardFooter className="text-[13px] text-muted">En nog {active.length - 6} op het bord.</CardFooter>}
          </Card>
        </div>

        <div className="flex min-w-0 flex-col gap-6">
          {/* Nieuwe meetresultaten: lopende metingen staan na een week niet meer op het bord */}
          {!loading && updates.items.length > 0 && (
            <Card aria-labelledby="v2-updates" className="border-accent-line">
              <CardHeader>
                <div>
                  <CardTitle id="v2-updates" className="flex items-center gap-2"><LineChart className="size-4 text-accent" />Nieuwe meetresultaten</CardTitle>
                  <CardDescription>{updates.items.length} {updates.items.length === 1 ? "meting is" : "metingen zijn"} binnengekomen.</CardDescription>
                </div>
                {updates.items.length > 1 && <Button variant="ghost" size="sm" onClick={updates.dismissAll}><Check />Alles gezien</Button>}
              </CardHeader>
              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {updates.items.slice(0, 5).map(u => (
                  <li key={u.key} className="flex items-start gap-1 pr-2">
                    <button onClick={() => u.ideaId ? router.push(`/content/${u.ideaId}?van=vandaag`) : openTask(u.taskKey!)} className="min-w-0 flex-1 cursor-pointer px-5 py-2.5 text-left outline-none transition-colors hover:bg-canvas focus-visible:bg-accent-soft">
                      <span className="flex items-center gap-2">
                        <Badge variant={u.final ? (u.tone === "goed" ? "accent" : u.tone === "slecht" ? "danger" : "default") : "default"}>{u.final ? "Eindoordeel" : `Na ${u.milestone} dagen`}</Badge>
                        <span className="text-xs text-subtle">{dateShort(u.date)}</span>
                      </span>
                      <span className="mt-1 block truncate text-sm font-semibold text-heading">{u.title}</span>
                      <span className="block text-xs text-muted">{u.text}</span>
                    </button>
                    <Button variant="ghost" size="icon" className="mt-2 shrink-0" onClick={() => updates.dismiss(u.key)} aria-label={`${u.title}: gezien`} title="Gezien"><Check /></Button>
                  </li>
                ))}
              </ul>
              {updates.items.length > 5 && <CardFooter className="text-[13px] text-muted">En nog {updates.items.length - 5}.</CardFooter>}
            </Card>
          )}

          {/* Gevolgde pagina's: wat Google deed met pagina's die je net hebt aangepast of gepubliceerd */}
          {feed.items.length > 0 && (
            <Card aria-labelledby="v2-volgen" className={lostPages.length ? "border-danger/25" : "border-accent-line"}>
              <CardHeader>
                <div>
                  <CardTitle id="v2-volgen" className="flex items-center gap-2"><Eye className="size-4 text-accent" />Gevolgde pagina&apos;s</CardTitle>
                  <CardDescription>{feed.items.length} {feed.items.length === 1 ? "nieuwe stap" : "nieuwe stappen"} bij Google. {feed.watchedCount} pagina&apos;s worden elke nacht gecontroleerd.</CardDescription>
                </div>
                {feed.items.length > 1 && <Button variant="ghost" size="sm" onClick={feed.dismissAll}><Check />Alles gezien</Button>}
              </CardHeader>
              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {feed.items.slice(0, 6).map(e => {
                  const ref = feed.watch[e.path]?.find(r => r.ref)
                  const open = () => ref?.kind === "content" ? router.push(`/content/${ref.ref}?van=vandaag`) : ref?.ref ? openTask(ref.ref) : router.push(`/advies`)
                  const good = EVENT_META[e.event].good
                  return (
                    <li key={`${e.path}${e.event}${e.at}`} className="flex items-start gap-1 pr-2" data-event={e.event}>
                      <button onClick={open} className="min-w-0 flex-1 cursor-pointer px-5 py-2.5 text-left outline-none transition-colors hover:bg-canvas focus-visible:bg-accent-soft">
                        <span className="flex items-center gap-2">
                          <Badge variant={good ? "accent" : "danger"}>{EVENT_META[e.event].label}</Badge>
                          <span className="text-xs text-subtle">{dateShort(e.at)}</span>
                        </span>
                        <span className="mt-1 block truncate text-sm font-semibold text-heading">{e.path}</span>
                        <span className="block text-xs text-muted">{EVENT_META[e.event].text(e)}</span>
                      </button>
                      <Button variant="ghost" size="icon" className="mt-2 shrink-0" onClick={() => feed.dismiss(e)} aria-label={`${e.path}: gezien`} title="Gezien"><Check /></Button>
                    </li>
                  )
                })}
              </ul>
              {feed.items.length > 6 && <CardFooter className="text-[13px] text-muted">En nog {feed.items.length - 6}.</CardFooter>}
            </Card>
          )}

          {/* Herinneringen */}
          <Card aria-labelledby="v2-herinneringen">
            <CardHeader>
              <div>
                <CardTitle id="v2-herinneringen" className="flex items-center gap-2"><BellRing className="size-4 text-amber" />Herinneringen</CardTitle>
                <CardDescription>{due.length ? `${due.length} voor vandaag, staat bovenaan` : "Niets voor vandaag"}{upcoming.length ? `. ${upcoming.length} gepland` : ""}</CardDescription>
              </div>
              <Button variant="ghost" size="icon" onClick={() => setReminding(true)} aria-label="Herinnering toevoegen"><Plus /></Button>
            </CardHeader>
            {upcoming.length > 0 && (
              <CardContent>
                <ul className="rem-upcoming flex flex-col gap-1.5">
                  {upcoming.slice(0, 5).map(t => (
                    <li key={t.key} className="grid grid-cols-[3.25rem_minmax(0,1fr)] items-baseline gap-2 text-[13px]">
                      <span className="font-semibold tabular-nums text-heading">{dateShort(t.snoozeUntil!)}</span>
                      <button className="cursor-pointer truncate text-left text-ink outline-none hover:text-accent focus-visible:underline" onClick={() => openTask(t.key)}>{t.signal.headline}</button>
                    </li>
                  ))}
                </ul>
              </CardContent>
            )}
            {!due.length && !upcoming.length && <CardContent><p className="text-[13px] text-muted">Zet iets op een datum dat dan terug moet komen, bijvoorbeeld een raadsbesluit.</p></CardContent>}
          </Card>

          {/* Meldingen (alleen als er iets is) */}
          {openAlerts.length > 0 && (
            <Card aria-labelledby="v2-meldingen" className="border-danger/25">
              <CardHeader><CardTitle id="v2-meldingen" className="flex items-center gap-2"><CircleAlert className="size-4 text-danger" />Meldingen</CardTitle></CardHeader>
              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {openAlerts.map(a => (
                  <li key={a.key} className="px-5 py-2.5 text-[13px]">
                    <span className="block font-semibold text-heading">{a.title}</span>
                    <span className="block text-muted">{a.detail}</span>
                    <span className="block text-xs text-subtle">Sinds {dateShort(a.first_seen)}</span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* Metingen */}
          <Card aria-labelledby="v2-metingen">
            <CardHeader>
              <div>
                <CardTitle id="v2-metingen">Metingen</CardTitle>
                <CardDescription>Wat je aanpaste, en wanneer het effect bekend is.</CardDescription>
              </div>
            </CardHeader>
            {measurements.length === 0 ? (
              <CardContent><p className="text-[13px] text-muted">Nog geen metingen. Die starten zodra je een taak als uitgevoerd markeert.</p></CardContent>
            ) : (
              <ul className="divide-y divide-line-soft border-t border-line-soft">
                {measurements.map(({ e, next, task }) => (
                  <li key={e.id}>
                    <button onClick={() => openTask(e.advice_key)} className="w-full cursor-pointer px-5 py-2.5 text-left outline-none transition-colors hover:bg-canvas focus-visible:bg-accent-soft">
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="truncate text-sm font-semibold text-heading">{task!.signal.query || task!.signal.headline}</span>
                        {e.outcome
                          ? <Badge variant={e.outcome === "succesvol" ? "accent" : e.outcome === "niet_succesvol" ? "danger" : "default"}>{e.outcome === "succesvol" ? "Geslaagd" : e.outcome === "niet_succesvol" ? "Niet geslaagd" : "Geen duidelijk effect"}</Badge>
                          : next && <span className="text-xs whitespace-nowrap text-subtle">{dateShort(next.date)}, na {next.days} d</span>}
                      </span>
                      <span className="block truncate text-xs text-muted">{e.description}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
            <CardFooter><Link href="/experimenten" className={buttonVariants({ variant: "link", size: "sm" })}>Alle metingen</Link></CardFooter>
          </Card>
        </div>
      </div>

      {adding && <AddTaskDialog onClose={() => setAdding(false)} />}
      {reminding && <ReminderDialog onClose={() => setReminding(false)} />}
    </div>
  )
}

// Herinnering die vandaag (of eerder) terugkomt, met dezelfde acties als op de huidige pagina
function DueReminder({ t, owner }: { t: Task; owner: string | null }) {
  const { removeTask, setStatus, snoozeReminder, openTask, toast } = useWorkspace()
  const router = useRouter()
  const [later, setLater] = useState(false)
  const [date, setDate] = useState(addDays(today(), 7))
  const [busy, setBusy] = useState(false)
  const r = t.signal.reminder!
  const late = t.snoozeUntil && t.snoozeUntil < today()

  const toContent = async () => {
    setBusy(true)
    try {
      const res = await fetch("/api/content", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ title: t.signal.headline, why: t.signal.description || t.signal.headline, sourceUrl: r.link || undefined }) })
      const j = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(j.error || `HTTP ${res.status}`)
      await removeTask(t, "Contentkans gemaakt; herinnering afgerond")
      router.push(`/content/${j.idea.id}`)
    } catch (e: any) { toast(`Contentkans maken mislukt: ${e.message}`, "error") } finally { setBusy(false) }
  }
  const toTask = async () => {
    setBusy(true)
    const { reminder: _r, ...signal } = t.signal
    const ok = await setStatus({ ...t, signal }, "goedgekeurd", { note: t.note })
    setBusy(false)
    if (ok) { toast("Taak gemaakt en gepland"); openTask(t.key) }
  }
  const reschedule = async () => {
    if (!date || date < today()) return
    setBusy(true)
    const ok = await snoozeReminder(t, date)
    setBusy(false)
    if (ok) { toast(`Herinnering verzet naar ${dateLong(date)}`); setLater(false) }
  }

  return (
    <li className="rem-card grid gap-3 rounded-control border border-amber/20 bg-card px-4 py-3.5 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
      <div className="min-w-0">
      <button className="block cursor-pointer text-left text-base font-semibold text-heading outline-none hover:text-accent focus-visible:underline" onClick={() => openTask(t.key)}>{t.signal.headline}</button>
      <p className="text-xs font-semibold text-amber">{late ? `Al sinds ${dateLong(t.snoozeUntil!)}` : "Vandaag"}{owner ? <span className="font-normal text-muted">, voor {owner}</span> : null}</p>
      {t.signal.description && <p className="mt-1 line-clamp-3 text-[13px] text-muted">{t.signal.description}</p>}
      {r.link && <a className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-xs text-accent hover:underline" href={r.link} target="_blank" rel="noopener noreferrer"><span className="truncate">{r.link.replace(/^https?:\/\/(www\.)?/, "")}</span><ExternalLink className="size-3 shrink-0" /></a>}
      </div>
      {later ? (
        <div className="flex flex-wrap items-center gap-1.5">
          <input type="date" className="h-8 rounded-control border border-line bg-card px-2 text-xs" min={today()} value={date} onChange={e => setDate(e.target.value)} aria-label="Nieuwe datum" />
          <Button size="sm" disabled={busy} onClick={reschedule}>Verzetten</Button>
          <Button size="sm" variant="ghost" onClick={() => setLater(false)}>Annuleren</Button>
        </div>
      ) : (
        <div className="flex flex-wrap gap-1.5 md:justify-end">
          <Button size="sm" disabled={busy} onClick={toContent}><Newspaper />Maak contentkans</Button>
          <Button size="sm" variant="outline" disabled={busy} onClick={toTask}><ListTodo />Maak taak</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => setLater(true)}><CalendarPlus />Later</Button>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => removeTask(t, "Herinnering afgerond")}><Check />Gedaan</Button>
        </div>
      )}
    </li>
  )
}
