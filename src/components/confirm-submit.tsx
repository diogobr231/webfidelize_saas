"use client";
import { useId, useRef, useState } from "react";
import { useFormStatus } from "react-dom";

/** Keep the action in its server form; confirmation never substitutes authorization. */
export function ConfirmSubmit({
  label,
  description,
  className = "secondary",
}: {
  label: string;
  description: string;
  className?: string;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const id = useId();
  const [open, setOpen] = useState(false);
  const { pending } = useFormStatus();
  return (
    <>
      <button
        type="button"
        className={`${className} confirm-trigger`}
        onClick={() => {
          setOpen(true);
          dialog.current?.showModal();
        }}
        disabled={pending}
      >
        {label}
      </button>
      <dialog
        ref={dialog}
        onClose={() => setOpen(false)}
        onCancel={() => setOpen(false)}
        className="ui-confirm-dialog"
        aria-labelledby={`${id}-title`}
        aria-describedby={`${id}-description`}
      >
        <h2 id={`${id}-title`}>{label}?</h2>
        <p id={`${id}-description`}>{description}</p>
        <div className="ui-confirm-actions">
          <button
            type="button"
            className="secondary"
            autoFocus
            onClick={() => dialog.current?.close()}
            disabled={pending}
          >
            Voltar
          </button>
          <button
            type="submit"
            name="confirm_action"
            value="yes"
            disabled={!open || pending}
            aria-busy={pending}
          >
            {pending ? "Aplicando…" : "Confirmar alteração"}
          </button>
        </div>
      </dialog>
      <noscript>
        <style>{`.confirm-trigger { display:none !important; }`}</style>
        <label className="ui-confirm-fallback">
          <input type="checkbox" name="confirm_action" value="yes" required />
          {description}
        </label>
        <button type="submit" className={className}>
          {label}
        </button>
      </noscript>
    </>
  );
}
