import type { Metadata } from "next"
import TodayView from "@/components/views/TodayView"

export const metadata: Metadata = { title: "Vandaag · Gijs Intelligence" }

export default function Page() {
  return <TodayView />
}
