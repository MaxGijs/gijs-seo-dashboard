"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { FileText, Search, Hash } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { toPath } from "@/lib/signals"
import { normalize, num, pos } from "@/lib/format"

interface Result { kind: "query" | "page"; value: string; meta: string }

// Zoek een zoekwoord of pagina en open direct de diagnose in het zijpaneel.
export default function SearchBox() {
  const { keywords, pages, openSubject, loading } = useWorkspace()
  const [q, setQ] = useState("")
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const boxRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = (e.target as HTMLElement)?.closest("input, textarea, select, [contenteditable]")
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    const onClick = (e: MouseEvent) => { if (!boxRef.current?.contains(e.target as Node)) setOpen(false) }
    window.addEventListener("keydown", onKey)
    window.addEventListener("mousedown", onClick)
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onClick) }
  }, [])

  const results = useMemo<Result[]>(() => {
    const n = normalize(q)
    if (!n) return []
    const kw = keywords.filter(k => normalize(k.keys[0]).includes(n)).slice(0, 6)
      .map(k => ({ kind: "query" as const, value: k.keys[0], meta: `positie ${pos(k.position)} · ${num(k.impressions)} vertoningen` }))
    const pg = pages.filter(p => normalize(toPath(p.keys[0])).includes(n)).slice(0, 5)
      .map(p => ({ kind: "page" as const, value: toPath(p.keys[0]), meta: `${num(p.impressions)} vertoningen` }))
    return [...kw, ...pg]
  }, [q, keywords, pages])

  const choose = (r?: Result) => {
    const target = r || (q.trim() ? { kind: q.trim().startsWith("/") ? "page" : "query", value: q.trim() } as Result : null)
    if (!target) return
    openSubject(target.kind === "query" ? { query: target.value } : { page: target.value })
    setOpen(false)
    setQ("")
    inputRef.current?.blur()
  }

  const kwResults = results.filter(r => r.kind === "query")
  const pgResults = results.filter(r => r.kind === "page")

  return (
    <div className="search" ref={boxRef}>
      <Search className="search-icon" aria-hidden />
      <input
        ref={inputRef}
        className="search-input"
        type="search"
        placeholder={loading ? "Gegevens laden…" : "Zoek een zoekwoord of pagina"}
        aria-label="Zoek een zoekwoord of pagina"
        aria-expanded={open && q.length > 0}
        aria-controls="search-results"
        role="combobox"
        value={q}
        onChange={e => { setQ(e.target.value); setOpen(true); setActive(0) }}
        onFocus={() => setOpen(true)}
        onKeyDown={e => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive(a => Math.min(a + 1, results.length - 1)) }
          if (e.key === "ArrowUp") { e.preventDefault(); setActive(a => Math.max(a - 1, 0)) }
          if (e.key === "Enter") { e.preventDefault(); choose(results[active]) }
          if (e.key === "Escape") { setOpen(false); inputRef.current?.blur() }
        }}
      />
      {!q && <span className="search-kbd" aria-hidden>/</span>}
      {open && q.trim().length > 0 && (
        <div className="search-results" id="search-results" role="listbox">
          {results.length === 0 ? (
            <button className="search-item" onClick={() => choose()}>
              {q.trim().startsWith("/") ? <FileText aria-hidden /> : <Hash aria-hidden />}
              <span>Analyseer <b>{q.trim()}</b></span>
              <span className="search-item-meta">niet in de top van de laatste 28 dagen</span>
            </button>
          ) : (
            <>
              {kwResults.length > 0 && <p className="search-group eyebrow">Zoekwoorden</p>}
              {kwResults.map(r => {
                const i = results.indexOf(r)
                return (
                  <button key={`q-${r.value}`} role="option" aria-selected={i === active} className={`search-item${i === active ? " is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                    <Hash aria-hidden /><span className="truncate">{r.value}</span><span className="search-item-meta">{r.meta}</span>
                  </button>
                )
              })}
              {pgResults.length > 0 && <p className="search-group eyebrow">Pagina&apos;s</p>}
              {pgResults.map(r => {
                const i = results.indexOf(r)
                return (
                  <button key={`p-${r.value}`} role="option" aria-selected={i === active} className={`search-item${i === active ? " is-active" : ""}`} onMouseEnter={() => setActive(i)} onClick={() => choose(r)}>
                    <FileText aria-hidden /><span className="truncate">{r.value}</span><span className="search-item-meta">{r.meta}</span>
                  </button>
                )
              })}
            </>
          )}
        </div>
      )}
    </div>
  )
}
