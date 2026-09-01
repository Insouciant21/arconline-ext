import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const badgeVariants = cva("arcaea-badge", {
  variants: {
    variant: {
      default: "arcaea-badge-cyan",
      muted: "arcaea-badge-muted",
      accent: "arcaea-badge-orange",
      outline: "arcaea-badge-outline",
    },
  },
  defaultVariants: { variant: "default" },
});

export function Badge({
  className,
  variant,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}
