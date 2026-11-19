import type { Metadata } from "next"
import TodayV2 from "@/components/v2/TodayV2"

export const metadata: Metadata = { title: "Vandaag · Gijs Intelligence" }

export default function Page() {
  return <TodayV2 />
}
