import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const buttonVariants = cva("arcaea-button", {
  variants: {
    variant: {
      default: "arcaea-button-primary",
      secondary: "arcaea-button-secondary",
      ghost: "arcaea-button-ghost",
      danger: "arcaea-button-danger",
    },
    size: {
      default: "arcaea-button-md",
      sm: "arcaea-button-sm",
      lg: "arcaea-button-lg",
      icon: "arcaea-button-icon",
    },
  },
  defaultVariants: { variant: "default", size: "default" },
});

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return <Comp className={cn(buttonVariants({ variant, size }), className)} ref={ref} {...props} />;
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
