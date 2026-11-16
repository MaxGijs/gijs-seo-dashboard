// Nederlandse notatie, zoals het GIJS design system voorschrijft: 12,5 · 1.234 · 2,2%

export function num(n: number | null | undefined, digits = 0) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—"
  return n.toLocaleString("nl-NL", { minimumFractionDigits: 0, maximumFractionDigits: digits })
}

export function pos(n: number | null | undefined) {
  return num(n, 1)
}

export function pct(ctr: number | null | undefined, digits = 1) {
  if (ctr === null || ctr === undefined || Number.isNaN(ctr)) return "—"
  return `${(ctr * 100).toLocaleString("nl-NL", { maximumFractionDigits: digits })}%`
}

export function signedPct(delta: number | null) {
  if (delta === null || !Number.isFinite(delta)) return null
  return `${delta > 0 ? "+" : ""}${Math.round(delta)}%`
}

const MONTHS = ["jan", "feb", "mrt", "apr", "mei", "jun", "jul", "aug", "sep", "okt", "nov", "dec"]
const MONTHS_LONG = ["januari", "februari", "maart", "april", "mei", "juni", "juli", "augustus", "september", "oktober", "november", "december"]
const DAYS = ["zondag", "maandag", "dinsdag", "woensdag", "donderdag", "vrijdag", "zaterdag"]

export function parseDate(d: string | Date) {
  if (d instanceof Date) return d
  return new Date(`${d.slice(0, 10)}T12:00:00`)
}

export function dateShort(d: string | Date) {
  const x = parseDate(d)
  return `${x.getDate()} ${MONTHS[x.getMonth()]}`
}

export function dateLong(d: string | Date) {
  const x = parseDate(d)
  return `${DAYS[x.getDay()]} ${x.getDate()} ${MONTHS_LONG[x.getMonth()]}`
}

export function isoDate(d: Date) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, "0")
  const day = String(d.getDate()).padStart(2, "0")
  return `${y}-${m}-${day}`
}

export function today() {
  return isoDate(new Date())
}

export function addDays(d: string, n: number) {
  const x = parseDate(d)
  x.setDate(x.getDate() + n)
  return isoDate(x)
}

export function daysBetween(a: string, b: string) {
  return Math.round((parseDate(b).getTime() - parseDate(a).getTime()) / 86400000)
}

export function relativeDay(d: string) {
  const diff = daysBetween(today(), d)
  if (diff === 0) return "vandaag"
  if (diff === 1) return "morgen"
  if (diff === -1) return "gisteren"
  if (diff > 1) return `over ${diff} dagen`
  return `${-diff} dagen geleden`
}

export function greeting(date = new Date()) {
  const h = date.getHours()
  if (h < 12) return "Goedemorgen"
  if (h < 18) return "Goedemiddag"
  return "Goedenavond"
}

export function normalize(s: string) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
}

export function capitalize(s: string) {
  return s.charAt(0).toUpperCase() + s.slice(1)
}

export function plural(n: number, one: string, many: string) {
  return `${num(n)} ${n === 1 ? one : many}`
}

// Korte notatie van de indicatieve winst, voor kaarten
export function gainShort(gain: number) {
  if (gain >= 1) {
    const lo = Math.max(1, Math.floor(gain * 0.6))
    const hi = Math.max(lo + 1, Math.ceil(gain * 1.3))
    return `±${lo}–${hi} clicks / 28 d`
  }
  if (gain >= 0.2) return "< 1 click / 28 d"
  return "vooral zichtbaarheid"
}
