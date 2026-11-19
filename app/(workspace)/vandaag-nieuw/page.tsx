import type { Metadata } from "next"
import "@/app/ui-v2.css"
import TodayV2 from "@/components/v2/TodayV2"

export const metadata: Metadata = { title: "Vandaag (nieuwe opmaak) · Gijs Intelligence" }

// Proefversie van de nieuwe opmaak, naast de huidige /vandaag
export default function Page() {
  return <TodayV2 />
}
