import type { Metadata } from "next"
import LearnedView from "@/components/views/LearnedView"

export const metadata: Metadata = { title: "Wat hebben we geleerd? · Gijs Intelligence" }

export default function Page() {
  return <LearnedView />
}
