import type { GscRow } from "./types"

// Gemiddelde doorklikratio (CTR) per positie. Branchegemiddelde als vertrekpunt;
// zodra groeninjestraat.nl op een positie genoeg vertoningen heeft, gebruiken we de eigen CTR.
// Alle uitkomsten zijn indicatief — dat zeggen we ook overal in de interface.
const BENCHMARK: [number, number][] = [
  [1, 0.28], [2, 0.155], [3, 0.11], [4, 0.08], [5, 0.065],
  [6, 0.05], [7, 0.04], [8, 0.033], [9, 0.028], [10, 0.025],
]

function benchmarkAt(p: number) {
  if (p <= 1) return BENCHMARK[0][1]
  if (p <= 10) {
    const lo = Math.floor(p), hi = Math.ceil(p)
    const a = BENCHMARK[lo - 1][1], b = BENCHMARK[hi - 1][1]
    return a + (b - a) * (p - lo)
  }
  if (p <= 15) return 0.012
  if (p <= 20) return 0.008
  if (p <= 30) return 0.004
  return 0.0015
}

const BUCKETS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "11-15", "16-20", "21-30", "31+"]
function bucketOf(p: number) {
  const r = Math.max(1, Math.round(p))
  if (r <= 10) return String(r)
  if (r <= 15) return "11-15"
  if (r <= 20) return "16-20"
  if (r <= 30) return "21-30"
  return "31+"
}

export interface CtrModel {
  at(position: number): number
  sourceAt(position: number): "eigen" | "benchmark"
  usesOwnData: boolean
}

const MIN_IMPRESSIONS = 300

export function buildCtrModel(keywords: GscRow[]): CtrModel {
  const acc = new Map<string, { clicks: number; impressions: number }>()
  for (const k of keywords) {
    const b = bucketOf(k.position)
    const v = acc.get(b) || { clicks: 0, impressions: 0 }
    v.clicks += k.clicks
    v.impressions += k.impressions
    acc.set(b, v)
  }
  const own = new Map<string, number>()
  for (const b of BUCKETS) {
    const v = acc.get(b)
    if (v && v.impressions >= MIN_IMPRESSIONS) own.set(b, v.clicks / v.impressions)
  }
  // Representatieve waarde per bucket (eigen data waar die er is). Daarna één doorgang van
  // betere naar slechtere posities: een slechtere positie mag nooit een hogere doorklik hebben.
  // Dat is voorzichtig: lage eigen doorklik telt ook voor de posities daarachter.
  const REP: Record<string, number> = { "11-15": 13, "16-20": 18, "21-30": 25, "31+": 40 }
  const fixed: number[] = []
  BUCKETS.forEach((b, i) => {
    const v = own.get(b) ?? benchmarkAt(REP[b] ?? Number(b))
    fixed.push(i === 0 ? v : Math.min(v, fixed[i - 1]))
  })
  return {
    usesOwnData: own.size > 0,
    sourceAt(position: number) {
      const p = Math.max(1, position)
      const i = BUCKETS.indexOf(bucketOf(p))
      // eigen data als de bucket eigen data heeft, of als eigen data het branchegemiddelde begrenst
      return own.has(BUCKETS[i]) || (i > 0 && benchmarkAt(p) > fixed[i - 1]) ? "eigen" : "benchmark"
    },
    at(position: number) {
      const p = Math.max(1, position)
      const b = bucketOf(p)
      const i = BUCKETS.indexOf(b)
      const raw = own.get(b) ?? benchmarkAt(p)
      const upper = i > 0 ? fixed[i - 1] : 1
      const lower = i < fixed.length - 1 ? fixed[i + 1] : 0
      return Math.min(Math.max(raw, lower), upper)
    },
  }
}

export function clicksAt(model: CtrModel, impressions: number, position: number) {
  return impressions * model.at(position)
}

// Extra clicks als een zoekwoord van positie `from` naar `to` gaat (bij gelijke vertoningen)
export function gainFromMove(model: CtrModel, impressions: number, from: number, to: number) {
  return Math.max(0, impressions * (model.at(to) - model.at(from)))
}
