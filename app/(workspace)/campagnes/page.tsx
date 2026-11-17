import type { Metadata } from "next"
import CampaignsView from "@/components/views/CampaignsView"

export const metadata: Metadata = { title: "Offline campagnes · Gijs Intelligence" }

export default function Page() {
  return <CampaignsView />
}
