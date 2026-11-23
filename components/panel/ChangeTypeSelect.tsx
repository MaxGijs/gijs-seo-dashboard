"use client"

// Type wijziging bij "uitgevoerd": volgt de beschrijving tot je zelf iets kiest
import { CHANGE_TYPES, inferChangeType, type ChangeType } from "@/lib/experiment"

export default function ChangeTypeSelect({ id, description, value, onChange, disabled }: { id: string; description: string; value: ChangeType | null; onChange: (v: ChangeType | null) => void; disabled?: boolean }) {
  const guess = inferChangeType(description)
  return (
    <label className="change-type" htmlFor={id}>
      <span className="field-label">Type wijziging</span>
      <select id={id} className="select" value={value || guess} disabled={disabled} onChange={e => onChange(e.target.value as ChangeType)}>
        {(Object.keys(CHANGE_TYPES) as ChangeType[]).map(k => <option key={k} value={k}>{CHANGE_TYPES[k]}</option>)}
      </select>
    </label>
  )
}
