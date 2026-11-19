import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"
import { cn } from "@/lib/utils"

// shadcn/ui Button in Gijs-kleuren, met Apple-pil: de ronde vorm betekent "dit is een actie"
const variants = cva(
  "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-full font-semibold transition-colors outline-none focus-visible:ring-3 focus-visible:ring-accent/40 disabled:pointer-events-none disabled:opacity-50 cursor-pointer [&_svg]:size-4 [&_svg]:shrink-0 [&_svg]:inline-block",
  {
    variants: {
      variant: {
        default: "bg-brand text-white hover:bg-brand-hover",
        outline: "border border-line bg-card text-heading hover:bg-canvas",
        ghost: "bg-transparent text-heading hover:bg-canvas",
        link: "bg-transparent text-accent underline-offset-4 hover:underline",
      },
      size: {
        default: "h-9 px-4 text-[13px]",
        sm: "h-8 px-3 text-xs",
        icon: "size-8",
      },
    },
    compoundVariants: [{ variant: "link", class: "h-auto px-0" }],
    defaultVariants: { variant: "default", size: "default" },
  },
)
// Via tailwind-merge, zodat bijv. de link-variant (px-0) wint van de padding van de maat
export const buttonVariants = (p?: VariantProps<typeof variants>) => cn(variants(p))

export function Button({ className, variant, size, ...props }: React.ComponentProps<"button"> & VariantProps<typeof variants>) {
  return <button data-slot="button" className={cn(buttonVariants({ variant, size }), className)} {...props} />
}
