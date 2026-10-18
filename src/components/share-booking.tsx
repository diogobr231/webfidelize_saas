"use client";

import { useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";

export function ShareBooking({
  url,
  companyName,
}: {
  url: string;
  companyName: string;
}) {
  const [feedback, setFeedback] = useState("");
  const input = useRef<HTMLInputElement>(null);
  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      setFeedback("Link copiado. Pronto para compartilhar!");
    } catch {
      input.current?.focus();
      input.current?.select();
      setFeedback("Selecione e copie o link abaixo para compartilhar.");
    }
  }
  return (
    <div className="share-booking">
      <label htmlFor="public-booking-link">Seu link de agendamento</label>
      <input
        ref={input}
        id="public-booking-link"
        readOnly
        value={url}
        onFocus={(event) => event.currentTarget.select()}
      />
      <div className="workspace-actions">
        <button type="button" onClick={copy}>
          <Icon name="copy" size={16} />
          Copiar link
        </button>
        <a
          className="button secondary"
          href={`https://wa.me/?text=${encodeURIComponent(`Agende seu horário em ${companyName}: ${url}`)}`}
          target="_blank"
          rel="noreferrer"
        >
          Compartilhar no WhatsApp ↗
        </a>
        <a
          className="workspace-text-link"
          href={url}
          target="_blank"
          rel="noreferrer"
        >
          Ver minha página ↗
        </a>
      </div>
      <p className="share-feedback" role="status" aria-live="polite">
        {feedback || "Envie para seus clientes ou adicione à bio do Instagram."}
      </p>
    </div>
  );
}
