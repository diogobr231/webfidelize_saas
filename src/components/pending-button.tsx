"use client";
import { useFormStatus } from "react-dom";

export function PendingButton({
  children,
  pendingLabel = "Salvando…",
  className,
}: {
  children: React.ReactNode;
  pendingLabel?: string;
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
      aria-live="polite"
      className={className}
    >
      {pending && <span className="ui-spinner" aria-hidden="true" />}
      {pending ? pendingLabel : children}
    </button>
  );
}
