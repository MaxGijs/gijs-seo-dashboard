import { auth } from "@/auth"
import AppShell from "@/components/shell/AppShell"
import LoginScreen from "@/components/shell/LoginScreen"

export const dynamic = "force-dynamic"

export default async function WorkspaceLayout({ children }: { children: React.ReactNode }) {
  const session = await auth()
  if (!session?.user) return <LoginScreen />
  return (
    <AppShell user={{ name: session.user.name, email: session.user.email, image: session.user.image }}>
      {children}
    </AppShell>
  )
}
