"use client";

import { useState } from "react";
import { formatCepAddress, normalizeCep } from "@/lib/cep-address";

type Props = {
  id: string;
  name: string;
  label: string;
  initialValue?: string;
  placeholder?: string;
  helper: string;
  maxLength: number;
  required?: boolean;
};

export function CepAddressInput({
  id,
  name,
  label,
  initialValue = "",
  placeholder,
  helper,
  maxLength,
  required = false,
}: Props) {
  const [cep, setCep] = useState("");
  const [address, setAddress] = useState(initialValue);
  const [suggestion, setSuggestion] = useState("");
  const [message, setMessage] = useState("");
  const [loading, setLoading] = useState(false);

  async function lookupCep() {
    const normalized = normalizeCep(cep);
    if (!normalized) {
      setMessage("Informe um CEP válido com 8 números.");
      setSuggestion("");
      return;
    }

    setLoading(true);
    setMessage("");
    setSuggestion("");
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 7000);
    try {
      const response = await fetch(
        `https://viacep.com.br/ws/${normalized}/json/`,
        { signal: controller.signal, headers: { Accept: "application/json" } },
      );
      if (!response.ok) throw new Error("lookup_failed");
      const data: unknown = await response.json();
      if (!data || typeof data !== "object" || "erro" in data) {
        setMessage(
          "Não encontramos esse CEP. Confira os números ou digite o endereço manualmente.",
        );
        return;
      }
      const addressSuggestion = formatCepAddress(
        data as Parameters<typeof formatCepAddress>[0],
        normalized,
      );
      if (!addressSuggestion) {
        setMessage(
          "O CEP não retornou uma cidade válida. Você pode preencher o endereço manualmente.",
        );
        return;
      }
      if (!address.trim()) {
        setAddress(addressSuggestion.slice(0, maxLength));
        setMessage(
          "Endereço preenchido. Confira e complete com número e complemento.",
        );
      } else {
        setSuggestion(addressSuggestion);
        setMessage(
          "Endereço localizado. Confira e complete com número e complemento.",
        );
      }
    } catch {
      setMessage(
        "A busca de CEP está indisponível agora. Você ainda pode preencher o endereço manualmente.",
      );
    } finally {
      window.clearTimeout(timeout);
      setLoading(false);
    }
  }

  function useSuggestion() {
    setAddress(suggestion.slice(0, maxLength));
    setSuggestion("");
  }

  return (
    <div className="cep-address-field">
      <div className="cep-address-lookup">
        <label htmlFor={`${id}-cep`}>CEP para preencher o endereço</label>
        <div className="cep-address-lookup-controls">
          <input
            id={`${id}-cep`}
            inputMode="numeric"
            autoComplete="postal-code"
            maxLength={9}
            value={cep}
            onChange={(event) => {
              const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
              setCep(
                digits.length > 5
                  ? `${digits.slice(0, 5)}-${digits.slice(5)}`
                  : digits,
              );
              setMessage("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void lookupCep();
              }
            }}
            placeholder="00000-000"
            aria-describedby={`${id}-cep-help ${id}-status`}
          />
          <button
            className="cep-address-lookup-button"
            type="button"
            onClick={() => void lookupCep()}
            disabled={loading}
          >
            {loading ? "Buscando…" : "Buscar CEP"}
          </button>
        </div>
        <small id={`${id}-cep-help`}>
          A busca só acontece quando você solicitar.
        </small>
      </div>
      <p
        className="cep-address-status"
        id={`${id}-status`}
        role="status"
        aria-live="polite"
      >
        {message}
      </p>
      {suggestion && (
        <button
          className="cep-address-use-suggestion"
          type="button"
          onClick={useSuggestion}
        >
          Usar: {suggestion}
        </button>
      )}
      <div className="cep-address-value">
        <label htmlFor={id}>{label}</label>
        <input
          id={id}
          name={name}
          value={address}
          onChange={(event) => setAddress(event.target.value)}
          autoComplete="street-address"
          maxLength={maxLength}
          placeholder={placeholder}
          required={required}
        />
        <small>{helper}</small>
      </div>
    </div>
  );
}
