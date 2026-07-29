import * as React from "react"
import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Materialize darkens a filled control on hover (its nav uses a
        // rgba(0,0,0,0.1) overlay); mixing toward --foreground darkens in light
        // and lifts in dark, so the direction stays correct in both themes.
        // The focus outline is separated from the fill by a background-colored
        // gap: --ring IS --primary, so the shared focus-visible:border-ring on
        // this variant draws blue on blue and disappears.
        default:
          "bg-primary text-primary-foreground hover:bg-[color-mix(in_oklch,var(--primary),var(--foreground)_12%)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring",
        outline:
          "border-border bg-background hover:bg-msg-hover hover:text-foreground aria-expanded:bg-msg-hover aria-expanded:text-foreground dark:border-input dark:bg-input/30 dark:hover:bg-input/50",
        secondary:
          "bg-secondary text-secondary-foreground hover:bg-[color-mix(in_oklch,var(--secondary),var(--foreground)_5%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground",
        ghost:
          "hover:bg-msg-hover hover:text-foreground aria-expanded:bg-msg-hover aria-expanded:text-foreground",
        // --destructive-ink, not --destructive: the label sits on the tint, not
        // on the page, where the token itself is 4.3:1.
        destructive:
          "bg-destructive/10 text-destructive-ink hover:bg-destructive/20 focus-visible:border-destructive/40 focus-visible:ring-destructive/20 dark:bg-destructive/20 dark:hover:bg-destructive/30 dark:focus-visible:ring-destructive/40",
        // msgplane's ID links carry color only — the underline is what it uses
        // to mark a link it does NOT want you to notice.
        link: "text-msg-link",
      },
      // Every size grows to a 44px touch target below md and snaps back to its
      // measured desktop height at md — the desktop geometry is matched to the
      // system this replaces and must not move.
      size: {
        default:
          "h-8 min-h-[44px] md:min-h-0 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 px-2 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 px-2.5 text-xs has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs": "size-6 [&_svg:not([class*='size-'])]:size-3",
        "icon-sm": "size-7",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  render,
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  const classes = cn(buttonVariants({ variant, size, className }))

  // `render={<Link/>}` asks for a control that NAVIGATES, and that is a link,
  // not a button. Base UI's Button assumes it wraps a real <button> and warns
  // on every page when it doesn't; the documented escape (nativeButton={false})
  // is worse than the warning, because its non-native branch merges
  // `{ role: "button" }` onto the element (internals/use-button/useButton.js),
  // which tells a screen reader "button" about an <a href> and throws away the
  // affordances a link carries — open in new tab, copy address, the lot.
  //
  // So a non-<button> render skips the primitive entirely and just wears the
  // button's clothes. Nothing is lost: focus ring and sizing are the classes,
  // and a link cannot be disabled or submit a form, which is all the primitive
  // was contributing. `type` is dropped for the same reason — its only job is
  // to stop a form submit, which an anchor never does.
  if (React.isValidElement<{ className?: string }>(render) && render.type !== "button") {
    const { type: _type, ...rest } = props
    return React.cloneElement(render, {
      "data-slot": "button",
      ...rest,
      className: cn(classes, render.props.className),
    } as Partial<typeof render.props>)
  }

  return (
    <ButtonPrimitive data-slot="button" className={classes} render={render} {...props} />
  )
}

export { Button, buttonVariants }
