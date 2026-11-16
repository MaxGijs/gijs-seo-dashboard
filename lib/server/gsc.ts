import { google } from "googleapis"

export const SITE_URL = "https://www.groeninjestraat.nl/"
export const SITE_ORIGIN = "https://www.groeninjestraat.nl"

// Search Console heeft ~2 dagen vertraging; we laten beide vensters op dezelfde
// "laatste complete dag" eindigen zodat huidige en vorige periode eerlijk vergelijkbaar zijn.
export const GSC_LAG_DAYS = 2

export function dateWindow(days: number, offset = 0) {
  const end = new Date()
  end.setUTCDate(end.getUTCDate() - GSC_LAG_DAYS - offset)
  const start = new Date(end)
  start.setUTCDate(start.getUTCDate() - (days - 1))
  const fmt = (d: Date) => d.toISOString().split("T")[0]
  return { startDate: fmt(start), endDate: fmt(end) }
}

// Service-account (voor nachtelijke taken zonder ingelogde gebruiker)
export function serviceSearchConsole() {
  const credentials = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT_JSON!)
  const auth = new google.auth.GoogleAuth({ credentials, scopes: ["https://www.googleapis.com/auth/webmasters.readonly"] })
  return google.searchconsole({ version: "v1", auth })
}

export function userSearchConsole(accessToken: string) {
  const oauth2 = new google.auth.OAuth2()
  oauth2.setCredentials({ access_token: accessToken })
  return google.searchconsole({ version: "v1", auth: oauth2 })
}

export interface GscRow { keys: string[]; clicks: number; impressions: number; ctr: number; position: number }

export async function gscQuery(
  sc: ReturnType<typeof userSearchConsole> | ReturnType<typeof serviceSearchConsole>,
  body: Record<string, unknown>
): Promise<GscRow[]> {
  const res = await sc.searchanalytics.query({ siteUrl: SITE_URL, requestBody: body } as any)
  return ((res as any).data?.rows || []) as GscRow[]
}

export function toPath(url: string) {
  const p = url.replace(/^https?:\/\/(www\.)?groeninjestraat\.nl/i, "")
  return p || "/"
}

export function toUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path
  return `${SITE_ORIGIN}${path === "/" ? "/" : path}`
}
