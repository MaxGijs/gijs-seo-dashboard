import type { Metadata } from "next"
import TasksView from "@/components/views/TasksView"

export const metadata: Metadata = { title: "Mijn taken · Gijs Intelligence" }

export default function Page() {
  return <TasksView />
}
