import { dateWindow, gscQuery, serviceSearchConsole, toPath } from "./gsc"

// Welke pagina's we op laadsnelheid meten: de homepage en de pagina's met de meeste Google-klikken
export async function cwvPages(n = 12) {
  const w = dateWindow(28)
  const rows = await gscQuery(serviceSearchConsole(), { startDate: w.startDate, endDate: w.endDate, dimensions: ["page"], rowLimit: 50 })
  const paths = rows.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).map(r => toPath(r.keys[0])).filter(p => !p.includes("#") && !p.includes("?"))
  return ["/", ...paths.filter(p => p !== "/")].slice(0, n)
}
