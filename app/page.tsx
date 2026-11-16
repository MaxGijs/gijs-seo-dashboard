import { auth } from "@/auth"
import { handleSignIn, handleSignOut } from "@/app/actions"
import Dashboard from "@/components/Dashboard"

export const dynamic = "force-dynamic"

export default async function Home() {
  const session = await auth()

  if (!session) {
    return (
      <main style={{
        minHeight: "100vh", display: "flex", alignItems: "center",
        justifyContent: "center", background: "var(--green-800)"
      }}>
        <div style={{ textAlign: "center", display: "flex", flexDirection: "column", alignItems: "center", gap: 32 }}>
          <div>
            <div style={{
              width: 56, height: 56, borderRadius: 16, background: "var(--accent-500)",
              display: "flex", alignItems: "center", justifyContent: "center",
              fontSize: 24, fontWeight: 700, color: "var(--green-800)", margin: "0 auto 16px"
            }}>G</div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: "#fff", margin: 0, letterSpacing: "-0.02em" }}>
              SEO Dashboard
            </h1>
            <p style={{ color: "rgba(255,255,255,0.6)", marginTop: 6, fontSize: 14 }}>
              groeninjestraat.nl
            </p>
          </div>
          <form action={handleSignIn}>
            <button type="submit" style={{
              background: "#fff", color: "var(--green-800)", fontFamily: "inherit",
              fontWeight: 600, fontSize: 14, padding: "12px 24px",
              borderRadius: "var(--radius-pill)", border: "none", cursor: "pointer",
              display: "flex", alignItems: "center", gap: 10, boxShadow: "var(--shadow-2)"
            }}>
              <svg width="18" height="18" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"/>
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/>
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/>
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/>
              </svg>
              Inloggen met Google
            </button>
          </form>
        </div>
      </main>
    )
  }

  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)" }}>
      <header style={{
        background: "rgba(255,255,255,0.92)", backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)", padding: "0 24px",
        height: 68, display: "flex", alignItems: "center", justifyContent: "space-between",
        position: "sticky", top: 0, zIndex: 100
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 10, background: "var(--green-800)",
            display: "flex", alignItems: "center", justifyContent: "center",
            fontWeight: 700, fontSize: 15, color: "var(--accent-500)"
          }}>G</div>
          <span style={{ fontWeight: 700, fontSize: 15, color: "var(--green-800)" }}>
            SEO <span style={{ color: "var(--accent-600)" }}>Dashboard</span>
          </span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div style={{
            display: "flex", alignItems: "center", gap: 8,
            background: "var(--grey-050)", border: "1px solid var(--border)",
            borderRadius: "var(--radius-pill)", padding: "4px 12px 4px 4px"
          }}>
            <div style={{
              width: 28, height: 28, borderRadius: "50%", background: "var(--green-800)",
              color: "var(--accent-500)", fontSize: 11, fontWeight: 700,
              display: "flex", alignItems: "center", justifyContent: "center"
            }}>
              {session.user?.name?.[0]?.toUpperCase() || "M"}
            </div>
            <span style={{ fontSize: 12, fontWeight: 600, color: "var(--grey-800)" }}>
              {session.user?.name?.split(" ")[0]}
            </span>
          </div>
          <form action={handleSignOut}>
            <button type="submit" style={{
              background: "none", border: "none", cursor: "pointer",
              fontSize: 12, color: "var(--muted)", fontFamily: "inherit"
            }}>Uitloggen</button>
          </form>
        </div>
      </header>
      <Dashboard />
    </main>
  )
}
