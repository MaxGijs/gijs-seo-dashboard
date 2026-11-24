// Paden en plaatsen (pure functies, gedeeld door metingen, waarschuwingen en zoeken)

export const normPage = (p: string) => {
  let x = p.trim().toLowerCase().replace(/^https?:\/\/[^/]+/, "").replace(/[?#].*$/, "")
  if (x.length > 1) x = x.replace(/\/+$/, "")
  return x || "/"
}

// Paden die in een tekst genoemd worden (bv. /regio/overijssel/zwolle/brinkhoek)
export function pathsIn(text: string): string[] {
  const out: string[] = []
  for (const m of text.matchAll(/(?:^|[\s("'“‘])(\/[a-z][a-z0-9-]*(?:\/[a-z0-9-]+)*)/gi)) out.push(m[1].replace(/\/+$/, "").toLowerCase())
  return [...new Set(out)]
}

// Plaats (gemeente) van een regiopagina: /regio/overijssel/zwolle/brinkhoek → "zwolle".
// Een provinciepagina (/regio/overijssel) heeft geen gemeente.
export function townOf(path: string): string | null {
  const s = normPage(path).split("/").filter(Boolean)
  return s[0] === "regio" && s.length >= 3 ? s[2] : null
}
