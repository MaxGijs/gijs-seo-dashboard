import type { Metadata } from "next"
import AnalysesView from "@/components/views/AnalysesView"

export const metadata: Metadata = { title: "SEO-analyses · Gijs Intelligence" }

export default function Page() {
  return <AnalysesView />
}
