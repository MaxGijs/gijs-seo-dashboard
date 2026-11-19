import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// shadcn/ui Badge; kleur alleen waar het iets betekent
export const badgeVariants = cva("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap [&_svg]:size-3 [&_svg]:inline-block", {
  variants: {
    variant: {
      default: "bg-canvas text-muted",
      accent: "bg-accent-soft text-accent",
      amber: "bg-amber-soft text-amber",
      danger: "bg-danger-soft text-danger",
    },
  },
  defaultVariants: { variant: "default" },
})

export function Badge({ className, variant, ...props }: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return <span data-slot="badge" className={cn(badgeVariants({ variant }), className)} {...props} />
}
