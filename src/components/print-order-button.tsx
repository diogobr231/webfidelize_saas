"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { money } from "@/lib/catalog";
import { Icon } from "@/components/ui/icon";

type Props = {
  companyName: string;
  orderName: string;
  tableName: string;
  details: string;
  status: string;
  amountCents: number | null;
  openedAt: string;
};

function formatOpenedAt(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime())
    ? date.toLocaleString("pt-BR", {
        timeZone: "America/Sao_Paulo",
        dateStyle: "short",
        timeStyle: "short",
      })
    : "";
}

export function PrintOrderButton({
  companyName,
  orderName,
  tableName,
  details,
  status,
  amountCents,
  openedAt,
}: Props) {
  const [mounted, setMounted] = useState(false);
  const [printing, setPrinting] = useState(false);
  const printRootRef = useRef<HTMLElement>(null);

  useEffect(() => {
    setMounted(true);
    const finishPrint = () => {
      printRootRef.current?.setAttribute("data-active", "false");
      setPrinting(false);
    };
    window.addEventListener("afterprint", finishPrint);
    return () => window.removeEventListener("afterprint", finishPrint);
  }, []);

  function printOrder() {
    if (!mounted || printing) return;
    setPrinting(true);
    printRootRef.current?.setAttribute("data-active", "true");
    window.print();
  }

  return (
    <>
      <button
        type="button"
        className="industry-op-print-button"
        onClick={printOrder}
        disabled={printing}
        title="Abre a janela de impressão para escolher a impressora."
      >
        <Icon name="printer" size={16} />
        Imprimir comanda
      </button>
      {mounted &&
        createPortal(
          <article
            ref={printRootRef}
            className="command-print-root"
            data-active={printing ? "true" : "false"}
            aria-hidden={!printing}
          >
            <header>
              <strong>{companyName}</strong>
              <span>COMANDA</span>
            </header>
            <h1>{orderName}</h1>
            <dl>
              <div>
                <dt>Mesa</dt>
                <dd>{tableName || "—"}</dd>
              </div>
              <div>
                <dt>Aberta em</dt>
                <dd>{formatOpenedAt(openedAt) || "—"}</dd>
              </div>
              <div>
                <dt>Etapa</dt>
                <dd>{status}</dd>
              </div>
            </dl>
            <section>
              <h2>Itens / observações</h2>
              <p>{details || "Nenhum item informado."}</p>
            </section>
            <footer>
              <span>Total registrado</span>
              <strong>
                {amountCents === null ? "Não informado" : money(amountCents)}
              </strong>
            </footer>
          </article>,
          document.body,
        )}
    </>
  );
}
