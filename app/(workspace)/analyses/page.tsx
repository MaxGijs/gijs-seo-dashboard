import type { Metadata } from "next"
import { Suspense } from "react"
import AnalysesView from "@/components/views/AnalysesView"

export const metadata: Metadata = { title: "SEO-analyses · Gijs Intelligence" }

export default function Page() {
  return <Suspense fallback={null}><AnalysesView /></Suspense>
}
