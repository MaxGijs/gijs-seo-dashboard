// Tekst uit de nieuwste bijlage (PDF of Word) van een contentkans halen, alleen lezen
import { getSupabase } from "./guard"

export async function latestAttachmentText(ideaId: string) {
  const sb = getSupabase()
  const { data: att } = await sb.from("seo_attachments").select("id, name, path, mime, created_at").eq("ref_kind", "content").eq("ref_id", ideaId).eq("confirmed", true).is("deleted_at", null)
    .in("mime", ["application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document"]).order("created_at", { ascending: false }).limit(1).maybeSingle()
  if (!att) return null
  const { data: blob, error } = await sb.storage.from("bijlagen").download(att.path)
  if (error || !blob) throw new Error(`Bestand kon niet worden geopend: ${error?.message || "onbekend"}`)
  const buf = new Uint8Array(await blob.arrayBuffer())
  let text = ""
  if (att.mime === "application/pdf") {
    const { extractText, getDocumentProxy } = await import("unpdf")
    const pdf = await getDocumentProxy(buf)
    const out = await extractText(pdf, { mergePages: false })
    text = (Array.isArray(out.text) ? out.text : [out.text]).join("\n\n")
  } else {
    const mammoth = await import("mammoth")
    text = (await mammoth.extractRawText({ buffer: Buffer.from(buf) })).value
  }
  return { text: text.slice(0, 120000), attachmentId: att.id as string, name: att.name as string, uploadedAt: att.created_at as string }
}
