import { NextResponse } from "next/server"
import { getSupabase, requireUser, supabaseConfigured } from "@/lib/server/guard"

// Bijlagen (bijv. het concept als PDF) bij een contentkans of taak. Bestanden staan in een
// privé-bucket; de browser uploadt rechtstreeks met een eenmalige upload-URL en bekijkt via een
// tijdelijke link. Oude versies blijven bewaard.
const BUCKET = "bijlagen"
const MAX = 25 * 1024 * 1024
const TYPES: Record<string, string> = {
  "application/pdf": "pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
  "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp",
}
const kindOk = (k: unknown): k is "content" | "taak" => k === "content" || k === "taak"
const bad = (m: string, s = 400) => NextResponse.json({ error: m }, { status: s })

export async function GET(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  if (!supabaseConfigured()) return NextResponse.json({ rows: [] })
  const sp = new URL(req.url).searchParams
  const kind = sp.get("kind"), ref = sp.get("ref")
  if (!kindOk(kind) || !ref) return bad("kind en ref zijn verplicht")
  const sb = getSupabase()
  const { data, error } = await sb.from("seo_attachments").select("id, name, path, size, mime, note, uploaded_by, created_at").eq("ref_kind", kind).eq("ref_id", ref).eq("confirmed", true).is("deleted_at", null).order("created_at", { ascending: false })
  if (error) return bad(error.message, 500)
  const rows = await Promise.all((data || []).map(async r => {
    const { data: s } = await sb.storage.from(BUCKET).createSignedUrl(r.path, 3600)
    const { data: d } = await sb.storage.from(BUCKET).createSignedUrl(r.path, 3600, { download: r.name })
    return { ...r, url: s?.signedUrl || null, download: d?.signedUrl || null }
  }))
  return NextResponse.json({ rows })
}

// POST { kind, ref, name, size, mime, note? } → eenmalige upload-URL
export async function POST(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  if (!supabaseConfigured()) return bad("Opslag niet geconfigureerd", 500)
  const b = await req.json().catch(() => ({}))
  if (!kindOk(b.kind) || !b.ref) return bad("kind en ref zijn verplicht")
  const ext = TYPES[b.mime]
  if (!ext) return bad("Alleen PDF, Word (.docx) of een afbeelding")
  if (!(Number(b.size) > 0) || Number(b.size) > MAX) return bad("Bestand is te groot (maximaal 25 MB)")
  const name = String(b.name || `bijlage.${ext}`).replace(/[\\/]/g, "-").slice(0, 160)
  const id = crypto.randomUUID()
  const safeRef = String(b.ref).replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80)
  const path = `${b.kind}/${safeRef}/${id}.${ext}`
  const sb = getSupabase()
  const { data: up, error: e1 } = await sb.storage.from(BUCKET).createSignedUploadUrl(path)
  if (e1 || !up) return bad(e1?.message || "Upload-URL maken mislukt", 500)
  const { error: e2 } = await sb.from("seo_attachments").insert({ id, ref_kind: b.kind, ref_id: String(b.ref).slice(0, 200), name, path, size: Math.round(Number(b.size)), mime: b.mime, note: b.note ? String(b.note).slice(0, 500) : null, uploaded_by: guard.session!.user!.email!.toLowerCase() })
  if (e2) return bad(e2.message, 500)
  return NextResponse.json({ id, uploadUrl: up.signedUrl })
}

// PATCH { id } → upload bevestigen (pas dan zichtbaar)
export async function PATCH(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  const b = await req.json().catch(() => ({}))
  const sb = getSupabase()
  const { data: row } = await sb.from("seo_attachments").select("path").eq("id", b.id).maybeSingle()
  if (!row) return bad("Bijlage niet gevonden", 404)
  const dir = row.path.split("/").slice(0, -1).join("/"), file = row.path.split("/").pop()
  const { data: list } = await sb.storage.from(BUCKET).list(dir, { search: file })
  if (!list?.some(f => f.name === file)) return bad("Het bestand is niet aangekomen; probeer opnieuw te uploaden", 409)
  await sb.from("seo_attachments").update({ confirmed: true }).eq("id", b.id)
  return NextResponse.json({ ok: true })
}

// DELETE ?id= → bijlage verwijderen
export async function DELETE(req: Request) {
  const guard = await requireUser(); if (guard.error) return guard.error
  const id = new URL(req.url).searchParams.get("id")
  if (!id) return bad("id ontbreekt")
  const sb = getSupabase()
  const { data: row } = await sb.from("seo_attachments").select("path").eq("id", id).maybeSingle()
  if (!row) return bad("Bijlage niet gevonden", 404)
  await sb.storage.from(BUCKET).remove([row.path])
  await sb.from("seo_attachments").update({ deleted_at: new Date().toISOString() }).eq("id", id)
  return NextResponse.json({ ok: true })
}
