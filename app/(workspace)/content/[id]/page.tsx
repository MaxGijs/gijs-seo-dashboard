import type { Metadata } from "next"
import ContentIdeaPage from "@/components/content/ContentIdeaPage"

export const metadata: Metadata = { title: "Contentopdracht · Gijs Intelligence" }

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  return <ContentIdeaPage id={id} />
}
