"use client"

// Nieuws over gevolgde pagina's voor Vandaag: wat er de laatste 14 dagen gebeurde bij Google
// (gecrawld, geïndexeerd, eerste vertoning, uit de index). "Gezien" is per browser.

import { useCallback, useEffect, useMemo, useState } from "react"
import { useWorkspace } from "@/lib/workspace"
import type { PageEvent, WatchReason } from "@/lib/watch"

const SEEN_KEY = "gijs.seo.seenPageEvents"
const read = () => { try { return window.localStorage.getItem(SEEN_KEY) } catch { return null } }
const write = (v: string) => { try { window.localStorage.setItem(SEEN_KEY, v) } catch { /* geen opslag */ } }
export const eventKey = (e: PageEvent) => `${e.path}|${e.event}|${e.at}`

export function usePageFeed() {
  const { reloadTick } = useWorkspace()
  const [d, setD] = useState<{ events: PageEvent[]; watch: Record<string, WatchReason[]>; watchedCount: number } | null>(null)
  const [seen, setSeen] = useState<Set<string>>(new Set())
  useEffect(() => { try { const v = JSON.parse(read() || "[]"); setSeen(new Set(Array.isArray(v) ? v : [])) } catch { /* leeg */ } }, [])
  useEffect(() => {
    fetch("/api/pages/events?feed=14", { cache: "no-store" }).then(r => r.ok ? r.json() : null).then(j => j && setD(j)).catch(() => {})
  }, [reloadTick])
  // Herhaalde crawls van een pagina die al geïndexeerd is, zijn geen nieuws
  const events = useMemo(() => (d?.events || []).filter(e => !(e.event === "gecrawld" && e.detail?.again)), [d])
  const items = useMemo(() => events.filter(e => !seen.has(eventKey(e))), [events, seen])
  const persist = (next: Set<string>) => { const live = new Set(events.map(eventKey)); write(JSON.stringify([...next].filter(k => live.has(k)))); setSeen(next) }
  const dismiss = useCallback((e: PageEvent) => persist(new Set([...seen, eventKey(e)])), [seen, events]) // eslint-disable-line react-hooks/exhaustive-deps
  const dismissAll = useCallback(() => persist(new Set([...seen, ...items.map(eventKey)])), [seen, items, events]) // eslint-disable-line react-hooks/exhaustive-deps
  return { items, watch: d?.watch || {}, watchedCount: d?.watchedCount ?? 0, loaded: !!d, dismiss, dismissAll }
}
