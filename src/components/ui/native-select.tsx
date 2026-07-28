import * as React from "react";
import { cn } from "@/lib/utils";

// A plain native <select>, used instead of the Base-UI-backed shadcn Select
// wherever the field must submit through a native <form action={serverAction}>
// via FormData (Base UI's Select doesn't map onto FormData the same way a
// native select does).
function NativeSelect({ className, ...props }: React.ComponentProps<"select">) {
  return (
    <select
      data-slot="native-select"
      className={cn(
        // Geometry deliberately mirrors ui/input.tsx — the two field types sit
        // side by side on every form and must agree, including the 16px mobile
        // step that keeps Safari from zooming the viewport on focus.
        "h-8 w-full min-w-0 rounded-md border border-input bg-transparent px-2.5 py-1 text-[16px] transition-colors md:text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 dark:bg-input/30",
        className
      )}
      {...props}
    />
  );
}

export { NativeSelect };
