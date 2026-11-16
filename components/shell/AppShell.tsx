"use client"

import type { ReactNode } from "react"
import { RefreshCw } from "lucide-react"
import { WorkspaceProvider, useWorkspace } from "@/lib/workspace"
import Sidebar from "./Sidebar"
import SearchBox from "./SearchBox"
import AdvicePanel from "@/components/panel/AdvicePanel"
import { Alert, Toasts } from "@/components/ui"
import { handleSignIn } from "@/app/actions"

type User = { name?: string | null; email?: string | null; image?: string | null }

function Topbar() {
  const { reload, loading } = useWorkspace()
  return (
    <header className="topbar">
      <SearchBox />
      <div className="topbar-spacer" />
      <button className="icon-btn icon-btn-outline" onClick={reload} disabled={loading} title="Gegevens opnieuw ophalen" aria-label="Gegevens opnieuw ophalen">
        <RefreshCw style={loading ? { animation: "spin 1s linear infinite" } : undefined} />
      </button>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
    </header>
  )
}

function GlobalStates() {
  const { authError, error, storageError, reload } = useWorkspace()
  if (authError) {
    return (
      <div style={{ marginBottom: 20 }}>
        <Alert tone="warning" title="Je Google-sessie is verlopen" action={
          <form action={handleSignIn}><button className="btn btn-primary btn-sm" type="submit">Opnieuw inloggen</button></form>
        }>
          Log opnieuw in om de Search Console-gegevens op te halen. Je opgeslagen taken en experimenten blijven bewaard.
        </Alert>
      </div>
    )
  }
  if (error) {
    return (
      <div style={{ marginBottom: 20 }}>
        <Alert tone="error" title="Search Console-gegevens konden niet worden opgehaald" action={<button className="btn btn-secondary btn-sm" onClick={reload}>Opnieuw proberen</button>}>
          {error}
        </Alert>
      </div>
    )
  }
  if (storageError) {
    return (
      <div style={{ marginBottom: 20 }}>
        <Alert tone="warning" title="Opgeslagen taken zijn niet bereikbaar">
          De adviezen worden getoond, maar statussen en experimenten konden niet worden geladen ({storageError}). Wijzigingen opslaan lukt mogelijk niet.
        </Alert>
      </div>
    )
  }
  return null
}

export default function AppShell({ user, children }: { user: User; children: ReactNode }) {
  return (
    <WorkspaceProvider user={user}>
      <div className="shell">
        <Sidebar user={user} />
        <div className="main">
          <Topbar />
          <main className="content" id="inhoud">
            <GlobalStates />
            {children}
          </main>
        </div>
      </div>
      <AdvicePanel />
      <Toasts />
    </WorkspaceProvider>
  )
}
