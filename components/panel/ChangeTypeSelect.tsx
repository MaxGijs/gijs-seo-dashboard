"use client"

// Type wijziging bij "uitgevoerd": volgt de beschrijving tot je zelf iets kiest. Meerdere soorten
// tegelijk kan (bv. tekst én interne link); minstens één blijft gekozen.
import { CHANGE_TYPES, changeTypesLabel, inferChangeType, type ChangeType } from "@/lib/experiment"

export default function ChangeTypeSelect({ id, description, value, onChange, disabled }: { id: string; description: string; value: ChangeType[] | null; onChange: (v: ChangeType[] | null) => void; disabled?: boolean }) {
  const chosen = value?.length ? value : [inferChangeType(description)]
  const toggle = (k: ChangeType) => {
    const next = chosen.includes(k) ? chosen.filter(x => x !== k) : [...chosen, k]
    if (next.length) onChange((Object.keys(CHANGE_TYPES) as ChangeType[]).filter(x => next.includes(x)))
  }
  return (
    <div className="change-type">
      <span className="field-label" id={`${id}-label`}>Type wijziging</span>
      <div className="change-type-chips" role="group" aria-labelledby={`${id}-label`} id={id}>
        {(Object.keys(CHANGE_TYPES) as ChangeType[]).map(k => {
          const on = chosen.includes(k)
          return (
            <button key={k} type="button" className={`ct-chip${on ? " is-on" : ""}`} aria-pressed={on} disabled={disabled || (on && chosen.length === 1)} onClick={() => toggle(k)}
              title={on && chosen.length === 1 ? "Minstens één soort blijft gekozen" : undefined}>
              {CHANGE_TYPES[k]}
            </button>
          )
        })}
      </div>
      <span className="field-hint">{chosen.length > 1 ? `Gecombineerd: ${changeTypesLabel(chosen)}.` : "Meerdere aanklikken kan, als je meer soorten tegelijk hebt aangepast."}{!value?.length ? " Afgeleid uit je omschrijving." : ""}</span>
    </div>
  )
}
