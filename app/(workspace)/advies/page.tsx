import type { Metadata } from "next"
import SiteAdviceView from "@/components/views/SiteAdviceView"

export const metadata: Metadata = { title: "Siteadvies · Gijs Intelligence" }

export default function Page() {
  return <SiteAdviceView />
}
