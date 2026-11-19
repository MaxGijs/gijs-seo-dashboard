import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

// shadcn/ui: klassen samenvoegen zonder conflicten (bv. "px-2" en "px-4")
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}
