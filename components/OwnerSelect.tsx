"use client"

import { UserRound } from "lucide-react"
import { useWorkspace } from "@/lib/workspace"

// Wie pakt dit op? Iedereen die ooit op het dashboard heeft ingelogd staat in de lijst.
export default function OwnerSelect({ value, onChange, disabled }: { value: string | null | undefined; onChange: (email: string | null) => void; disabled?: boolean }) {
  const { users, me } = useWorkspace()
  const list = [...users]
  if (value && !list.some(u => u.email === value)) list.push({ email: value, name: null, image: null })
  return (
    <label className="owner-select" title="Wie pakt dit op?">
      <UserRound aria-hidden />
      <span className="sr-only">Eigenaar</span>
      <select value={value || ""} disabled={disabled} onChange={e => onChange(e.target.value || null)}>
        <option value="">Niemand toegewezen</option>
        {list.map(u => <option key={u.email} value={u.email}>{u.email === me ? `${u.name || u.email} (ik)` : u.name || u.email}</option>)}
      </select>
    </label>
  )
}

export function ownerName(email: string | null | undefined, users: { email: string; name: string | null }[], me?: string | null) {
  if (!email) return null
  if (email === me) return "Ik"
  const u = users.find(x => x.email === email)
  return (u?.name || email).split(" ")[0]
}
