"use client";

import type { VariantProps } from "class-variance-authority";
import { ArrowRight } from "lucide-react";
import { Button, buttonVariants } from "@/app/components/ui/button";
import { cn } from "@/app/lib/cn";

export function StartButton({
  label = "Start diagnosis",
  className,
  size = "lg",
  variant = "default",
}: {
  label?: string;
  className?: string;
  size?: VariantProps<typeof buttonVariants>["size"];
  variant?: VariantProps<typeof buttonVariants>["variant"];
}) {
  return (
    <Button
      asChild
      variant={variant}
      size={size}
      className={cn("group", className)}
    >
      <a
        href="#workspace"
        onClick={() => {
          window.setTimeout(() => {
            document
              .getElementById("incident-input")
              ?.focus({ preventScroll: true });
          }, 450);
        }}
      >
        {label}
        <ArrowRight className="transition-transform duration-200 group-hover:translate-x-0.5" />
      </a>
    </Button>
  );
}
