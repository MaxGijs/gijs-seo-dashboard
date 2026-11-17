import type { Metadata } from "next"
import ConnectorView from "@/components/views/ConnectorView"

export const metadata: Metadata = { title: "Claude-koppeling · Gijs Intelligence" }

export default function Page() {
  return <ConnectorView />
}
