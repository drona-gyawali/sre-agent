import { cn } from "@/app/lib/cn";

export function Logo({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <span
        className={cn(
          "relative grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-[11px] bg-primary text-primary-foreground shadow-sm",
          markClassName
        )}
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          className="h-5 w-5"
          aria-hidden="true"
        >
          <path
            d="M3.5 12h3.1l2.2-5.4 3.3 10.8 2.4-6.2 1.5 3.2h4.5"
            stroke="currentColor"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
        <span className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_30%_0%,rgba(255,255,255,0.28),transparent_60%)]" />
      </span>
    </span>
  );
}
