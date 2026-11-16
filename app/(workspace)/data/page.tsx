import type { Metadata } from "next"
import DataStatusView from "@/components/views/DataStatusView"

export const metadata: Metadata = { title: "Datastatus · Gijs Intelligence" }

export default function Page() {
  return <DataStatusView />
}
