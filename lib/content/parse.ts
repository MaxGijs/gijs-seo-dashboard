// Uitlezen van nieuwsbronnen (RSS en de nieuwspagina van Milieu Centraal). Puur, zonder netwerk.

export interface Item { sourceId: string; url: string; title: string; summary: string; published: string | null; firstSeen: boolean }

const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " }
function decode(s: string) {
  return s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENT[n.toLowerCase()] ?? m)
    .replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()
}

export function parseRss(xml: string, sourceId: string): Item[] {
  return [...xml.matchAll(/<item>([\s\S]*?)<\/item>/g)].map(m => {
    const get = (tag: string) => { const r = m[1].match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`)); return r ? decode(r[1]) : "" }
    const pub = get("pubDate")
    const d = pub ? new Date(pub) : null
    return { sourceId, url: get("link"), title: get("title"), summary: get("description"), published: d && !isNaN(+d) ? d.toISOString() : null, firstSeen: !d }
  }).filter(i => i.url && i.title)
}

const MONTHS: Record<string, number> = { januari: 0, februari: 1, maart: 2, april: 3, mei: 4, juni: 5, juli: 6, augustus: 7, september: 8, oktober: 9, november: 10, december: 11 }
export function parseMilieuCentraal(html: string): Item[] {
  return [...html.matchAll(/<a[^>]+href="(\/nieuwsberichten\/[^"]+)"[^>]*>([\s\S]*?)<\/a>/g)].map(m => {
    const inner = m[2].replace(/<svg[\s\S]*?<\/svg>/g, "")
    const title = decode((inner.match(/<h2[^>]*>([\s\S]*?)<\/h2>/) || [])[1] || "")
    const texts = [...inner.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/g)].map(p => decode(p[1]))
    let published: string | null = null, summary = ""
    for (const t of texts) {
      const d = t.match(/^(\d{1,2}) ([a-z]+) (\d{4})$/i)
      if (d && MONTHS[d[2].toLowerCase()] !== undefined) published = new Date(Date.UTC(+d[3], MONTHS[d[2].toLowerCase()], +d[1], 9)).toISOString()
      else if (t.length > summary.length) summary = t
    }
    return { sourceId: "milieucentraal", url: `https://www.milieucentraal.nl${m[1]}`, title, summary, published, firstSeen: !published }
  }).filter(i => i.title)
}

