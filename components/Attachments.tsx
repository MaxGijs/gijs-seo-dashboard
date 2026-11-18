"use client"

import { useCallback, useEffect, useRef, useState } from "react"
import { Download, Eye, EyeOff, FileText, Paperclip, Trash2, Upload } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"
import { ownerName } from "@/components/OwnerSelect"

interface Row { id: string; name: string; size: number | null; mime: string | null; note: string | null; uploaded_by: string | null; created_at: string; url: string | null; download: string | null }

const ACCEPT = ".pdf,.docx,.png,.jpg,.jpeg,.webp,application/pdf"
const MAX = 25 * 1024 * 1024
const kb = (n: number | null) => n === null ? "" : n > 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB` : `${Math.max(1, Math.round(n / 1024))} kB`
const when = (s: string) => new Date(s).toLocaleString("nl-NL", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })

// Bijlagen bij een contentkans of taak, zoals inleveren in Brightspace: elke upload is een nieuwe
// versie, de nieuwste staat bovenaan en is direct te bekijken.
export default function Attachments({ kind, refId, onCount }: { kind: "content" | "taak"; refId: string; onCount?: (n: number) => void }) {
  const { toast, users, me } = useWorkspace()
  const [rows, setRows] = useState<Row[] | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [file, setFile] = useState<File | null>(null)
  const [note, setNote] = useState("")
  const [progress, setProgress] = useState<number | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [confirmDel, setConfirmDel] = useState<string | null>(null)
  const [drag, setDrag] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch(`/api/attachments?kind=${kind}&ref=${encodeURIComponent(refId)}`, { cache: "no-store" }); const j = await r.json()
      if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      setRows(j.rows); setErr(null); onCount?.(j.rows.length)
    } catch (e: any) { setErr(e.message) }
  }, [kind, refId]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { load() }, [load])

  const pick = (f: File | null | undefined) => {
    if (!f) return
    if (f.size > MAX) { toast("Bestand is te groot (maximaal 25 MB)", "error"); return }
    if (!/\.(pdf|docx|png|jpe?g|webp)$/i.test(f.name)) { toast("Alleen PDF, Word (.docx) of een afbeelding", "error"); return }
    setFile(f)
  }

  const upload = async () => {
    if (!file) return
    const mime = file.type || (file.name.toLowerCase().endsWith(".pdf") ? "application/pdf" : file.name.toLowerCase().endsWith(".docx") ? "application/vnd.openxmlformats-officedocument.wordprocessingml.document" : "")
    setProgress(0)
    try {
      const r = await fetch("/api/attachments", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, ref: refId, name: file.name, size: file.size, mime, note: note.trim() || null }) })
      const j = await r.json(); if (!r.ok) throw new Error(j.error || `HTTP ${r.status}`)
      // Rechtstreeks naar de opslag, met voortgang
      await new Promise<void>((resolve, reject) => {
        const x = new XMLHttpRequest()
        x.open("PUT", j.uploadUrl)
        x.upload.onprogress = e => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100))
        x.onload = () => (x.status < 300 ? resolve() : reject(new Error(`Upload mislukt (${x.status})`)))
        x.onerror = () => reject(new Error("Upload mislukt: geen verbinding met de opslag"))
        const fd = new FormData(); fd.append("cacheControl", "3600"); fd.append("", file)
        x.send(fd)
      })
      const c = await fetch("/api/attachments", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: j.id }) })
      if (!c.ok) throw new Error((await c.json().catch(() => ({}))).error || "Bevestigen mislukt")
      toast(rows?.length ? "Nieuwe versie geüpload" : "Bijlage geüpload")
      setFile(null); setNote(""); if (input.current) input.current.value = ""
      await load()
    } catch (e: any) { toast(e.message, "error") } finally { setProgress(null) }
  }

  const remove = async (id: string) => {
    const r = await fetch(`/api/attachments?id=${id}`, { method: "DELETE" })
    if (r.ok) { toast("Bijlage verwijderd"); setConfirmDel(null); if (preview === id) setPreview(null); load() } else toast("Verwijderen mislukt", "error")
  }

  const versions = rows || []
  return (
    <section className="psec" aria-labelledby={`att-${kind}`}>
      <h3 className="psec-title" id={`att-${kind}`}><Paperclip aria-hidden />Bijlagen{versions.length ? <span className="subtle">{versions.length} {versions.length === 1 ? "bestand" : "versies"}</span> : null}</h3>
      {err && <p className="field-error">{err}</p>}
      {versions.length > 0 && (
        <ul className="att-list">
          {versions.map((r, i) => (
            <li key={r.id} className={i === 0 ? "is-latest" : ""}>
              <div className="att-row">
                <FileText aria-hidden className="att-icon" />
                <div className="att-main">
                  <b className="truncate">{r.name}</b>
                  <span>{i === 0 ? "Nieuwste" : `Versie ${versions.length - i}`} · {when(r.created_at)} · {r.uploaded_by ? ownerName(r.uploaded_by, users, me) : "onbekend"} · {kb(r.size)}</span>
                  {r.note && <span className="att-note">{r.note}</span>}
                </div>
                <div className="att-actions">
                  {r.mime === "application/pdf" || r.mime?.startsWith("image/") ? <button className="icon-btn" aria-label={preview === r.id ? `Verberg ${r.name}` : `Bekijk ${r.name}`} title={preview === r.id ? "Verbergen" : "Bekijken"} onClick={() => setPreview(p => p === r.id ? null : r.id)}>{preview === r.id ? <EyeOff /> : <Eye />}</button> : null}
                  {r.download && <a className="icon-btn" href={r.download} aria-label={`Download ${r.name}`} title="Downloaden"><Download /></a>}
                  {confirmDel === r.id
                    ? <><button className="btn btn-ghost btn-sm" onClick={() => setConfirmDel(null)}>Annuleren</button><button className="btn btn-danger btn-sm" onClick={() => remove(r.id)}>Verwijderen</button></>
                    : <button className="icon-btn" aria-label={`Verwijder ${r.name}`} title="Verwijderen" onClick={() => setConfirmDel(r.id)}><Trash2 /></button>}
                </div>
              </div>
              {preview === r.id && r.url && (r.mime === "application/pdf"
                ? <iframe className="att-preview" src={r.url} title={r.name} />
                : <img className="att-preview-img" src={r.url} alt={r.name} />)}
            </li>
          ))}
        </ul>
      )}
      <div className={`att-drop${drag ? " is-drag" : ""}`} onDragOver={e => { e.preventDefault(); setDrag(true) }} onDragLeave={() => setDrag(false)} onDrop={e => { e.preventDefault(); setDrag(false); pick(e.dataTransfer.files?.[0]) }}>
        <input ref={input} type="file" accept={ACCEPT} className="sr-only" id={`att-file-${kind}`} onChange={e => pick(e.target.files?.[0])} />
        {!file ? (
          <label htmlFor={`att-file-${kind}`} className="att-pick"><Upload aria-hidden />{versions.length ? "Nieuwe versie uploaden" : "PDF uploaden"} <span className="subtle">of sleep een bestand hierheen · PDF, Word of afbeelding, max. 25 MB</span></label>
        ) : (
          <div className="att-ready">
            <p><b>{file.name}</b> <span className="subtle">{kb(file.size)}</span></p>
            {versions.length > 0 && <input className="input" value={note} onChange={e => setNote(e.target.value)} placeholder="Wat is er veranderd? (optioneel)" maxLength={500} />}
            {progress !== null && <div className="att-progress" role="progressbar" aria-valuenow={progress} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress}%` }} /></div>}
            <div className="inline-form-actions">
              <button className="btn btn-ghost btn-sm" disabled={progress !== null} onClick={() => { setFile(null); if (input.current) input.current.value = "" }}>Annuleren</button>
              <button className="btn btn-primary btn-sm" disabled={progress !== null} onClick={upload}>{progress !== null ? `Uploaden… ${progress}%` : "Uploaden"}</button>
            </div>
          </div>
        )}
      </div>
    </section>
  )
}
