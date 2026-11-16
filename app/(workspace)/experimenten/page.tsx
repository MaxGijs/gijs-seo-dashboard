import type { Metadata } from "next"
import ExperimentsView from "@/components/views/ExperimentsView"

export const metadata: Metadata = { title: "Experimenten · Gijs Intelligence" }

export default function Page() {
  return <ExperimentsView />
}
