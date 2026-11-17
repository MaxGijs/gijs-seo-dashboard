// Persoonlijke koppeltokens voor de Claude-koppeling. Alleen de hash wordt bewaard;
// het token zelf zie je één keer, bij het aanmaken.
import { createHash, randomBytes } from "node:crypto"
import { getSupabase } from "./guard"

export const hashToken = (t: string) => createHash("sha256").update(t).digest("hex")
export const newToken = () => `gijs_${randomBytes(24).toString("base64url")}`

export async function actorForToken(token: string) {
  if (!/^gijs_[A-Za-z0-9_-]{20,}$/.test(token)) return null
  const sb = getSupabase()
  const { data } = await sb.from("seo_mcp_tokens").select("id, email, name, revoked_at").eq("token_hash", hashToken(token)).maybeSingle()
  if (!data || data.revoked_at) return null
  await sb.from("seo_mcp_tokens").update({ last_used_at: new Date().toISOString() }).eq("id", data.id)
  return { email: data.email as string, name: (data.name as string | null) || null }
}
