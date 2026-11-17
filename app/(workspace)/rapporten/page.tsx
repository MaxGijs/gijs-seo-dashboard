import type { Metadata } from "next"
import ReportsView from "@/components/views/ReportsView"

export const metadata: Metadata = { title: "Vrijdagrapport · Gijs Intelligence" }

export default function Page() {
  return <ReportsView />
}
