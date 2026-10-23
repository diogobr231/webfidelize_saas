"use client";

import { useState, type InputHTMLAttributes } from "react";
import "./password-input.css";

type PasswordInputProps = Omit<
  InputHTMLAttributes<HTMLInputElement>,
  "type"
> & {
  id: string;
};

export function PasswordInput({ id, disabled, ...props }: PasswordInputProps) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="password-field">
      <input
        {...props}
        id={id}
        disabled={disabled}
        type={visible ? "text" : "password"}
      />
      <button
        className="password-visibility"
        type="button"
        disabled={disabled}
        aria-label={visible ? "Ocultar senha" : "Mostrar senha"}
        aria-controls={id}
        aria-pressed={visible}
        title={visible ? "Ocultar senha" : "Mostrar senha"}
        onClick={() => setVisible((current) => !current)}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" />
          <circle cx="12" cy="12" r="3" />
          {visible && <path d="m3 3 18 18" />}
        </svg>
      </button>
    </div>
  );
}
