// Wie voert een verzoek uit als het niet via de browser komt, maar via de Claude-koppeling.
// De koppeling roept dezelfde API-handlers aan als het dashboard; requireUser() leest dan
// de gebruiker van het (geverifieerde) koppeltoken uit deze context in plaats van uit de cookie.
import { AsyncLocalStorage } from "node:async_hooks"

export interface Actor { email: string; name: string | null }
const store = new AsyncLocalStorage<Actor>()

export const currentActor = () => store.getStore() || null
export function asActor<T>(actor: Actor, fn: () => Promise<T>) { return store.run(actor, fn) }
