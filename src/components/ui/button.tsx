import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";

import { cn } from "@/shared/core/ui/class-names";

const buttonVariants = cva(
  "inline-flex items-center justify-center rounded-[var(--radius-control)] border border-transparent text-sm font-semibold transition-[background-color,border-color,color,box-shadow,transform] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-primary text-primary-foreground shadow-sm hover:bg-[var(--primary-hover)]",
        secondary:
          "border-border bg-card text-secondary-foreground shadow-sm hover:border-[var(--border-strong)] hover:bg-secondary",
        ghost: "bg-transparent text-foreground hover:bg-muted",
        destructive: "bg-danger text-white shadow-sm hover:bg-danger/90",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-9 px-3",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
  VariantProps<typeof buttonVariants> & {
    asChild?: boolean;
  };

function Button({
  asChild = false,
  className,
  size,
  variant,
  ...props
}: ButtonProps) {
  const Component = asChild ? Slot : "button";

  return (
    <Component
      className={cn(buttonVariants({ size, variant, className }))}
      {...props}
    />
  );
}

export { Button, buttonVariants };
