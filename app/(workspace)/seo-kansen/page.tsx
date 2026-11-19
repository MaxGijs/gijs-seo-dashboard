import type { Metadata } from "next"
import SeoKansenView from "@/components/views/SeoKansenView"

export const metadata: Metadata = { title: "SEO-kansen · Gijs Intelligence" }

export default function Page() {
  return <SeoKansenView />
}
