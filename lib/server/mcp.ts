// MCP-protocol (JSON-RPC) voor de Claude-koppeling
import { asActor } from "./actor"
import { INSTRUCTIONS, TOOLS } from "./agent"
import { getSupabase, supabaseConfigured } from "./guard"

const VERSIONS = ["2025-06-18", "2025-03-26", "2024-11-05"]
export type Msg = { jsonrpc: "2.0"; id?: string | number | null; method?: string; params?: any }
export const ok = (id: Msg["id"], result: unknown) => ({ jsonrpc: "2.0", id, result })
export const fail = (id: Msg["id"], code: number, message: string) => ({ jsonrpc: "2.0", id: id ?? null, error: { code, message } })

export async function handle(m: Msg, actor: { email: string; name: string | null }) {
  switch (m.method) {
    case "initialize": {
      const asked = m.params?.protocolVersion
      return ok(m.id, {
        protocolVersion: VERSIONS.includes(asked) ? asked : VERSIONS[0],
        capabilities: { tools: { listChanged: false } },
        serverInfo: { name: "gijs-intelligence", title: "Gijs Intelligence", version: "1.0.0" },
        instructions: INSTRUCTIONS,
      })
    }
    case "ping": return ok(m.id, {})
    case "tools/list":
      return ok(m.id, { tools: TOOLS.map(t => ({ name: t.name, title: t.title, description: t.description, inputSchema: t.inputSchema, annotations: { title: t.title, readOnlyHint: t.readOnly, destructiveHint: false, openWorldHint: false } })) })
    case "tools/call": {
      const tool = TOOLS.find(t => t.name === m.params?.name)
      if (!tool) return fail(m.id, -32602, `Onbekende tool: ${m.params?.name}`)
      try {
        const result = await asActor(actor, () => tool.run(m.params?.arguments || {}, actor))
        log(actor.email, tool.name, true, tool.readOnly ? null : JSON.stringify(m.params?.arguments || {}).slice(0, 500))
        return ok(m.id, { content: [{ type: "text", text: JSON.stringify(result, null, 1) }], structuredContent: result as any })
      } catch (e: any) {
        log(actor.email, tool.name, false, e?.message || "fout")
        return ok(m.id, { content: [{ type: "text", text: `Mislukt: ${e?.message || "onbekende fout"}` }], isError: true })
      }
    }
    case "resources/list": return ok(m.id, { resources: [] })
    case "prompts/list": return ok(m.id, { prompts: [] })
    default: return m.method?.startsWith("notifications/") ? null : fail(m.id, -32601, `Onbekende methode: ${m.method}`)
  }
}

function log(email: string, tool: string, success: boolean, detail: string | null) {
  if (!supabaseConfigured()) return
  getSupabase().from("seo_mcp_log").insert({ email, tool, ok: success, detail }).then(() => {}, () => {})
}

