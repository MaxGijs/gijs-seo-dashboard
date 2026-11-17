import type { Metadata } from "next"
import DashboardView from "@/components/views/DashboardView"

export const metadata: Metadata = { title: "Dashboard · Gijs Intelligence" }

export default function Page() {
  return <DashboardView />
}
