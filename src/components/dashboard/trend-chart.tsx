"use client";

import { useRef, useState } from "react";
import {
  dashboardDate,
  dashboardBuckets,
  type DashboardDay,
} from "@/lib/dashboard";
import { EmptyState } from "@/components/ui/empty-state";

type Metric = "appointments" | "completed" | "new_customers";
const labels: Record<Metric, string> = {
  appointments: "Agendamentos",
  completed: "Concluídos",
  new_customers: "Novos clientes",
};

export function TrendChart({
  daily,
  managed,
}: {
  daily: DashboardDay[];
  managed: boolean;
}) {
  const [metric, setMetric] = useState<Metric>("appointments");
  const [selected, setSelected] = useState(0);
  const bars = useRef<(HTMLButtonElement | null)[]>([]);
  const buckets = dashboardBuckets(daily);
  const maximum = Math.max(1, ...buckets.map((item) => item[metric] ?? 0));
  const total = buckets.reduce((sum, item) => sum + (item[metric] ?? 0), 0);
  const active = buckets[Math.min(selected, buckets.length - 1)];
  const period = (first: string, last: string) =>
    first === last
      ? dashboardDate(first)
      : `${dashboardDate(first)} – ${dashboardDate(last)}`;
  const metrics: Metric[] = managed
    ? ["appointments", "completed", "new_customers"]
    : ["appointments", "completed"];
  return (
    <section
      className="panel executive-chart"
      aria-labelledby="executive-evolution-title"
    >
      <div className="executive-panel-heading">
        <div>
          <span className="tag">Evolução no período</span>
          <h2 id="executive-evolution-title">O ritmo dos seus atendimentos</h2>
        </div>
      </div>
      <div
        className="executive-chart-tabs"
        role="group"
        aria-label="Indicador do gráfico"
      >
        {metrics.map((name) => (
          <button
            key={name}
            type="button"
            aria-pressed={metric === name}
            onClick={() => {
              setMetric(name);
              setSelected(0);
            }}
          >
            {labels[name]}
          </button>
        ))}
      </div>
      {total === 0 ? (
        <EmptyState
          icon={metric === "new_customers" ? "users" : "calendar"}
          title={
            metric === "new_customers"
              ? "Nenhum novo cliente registrado neste período"
              : "Seu próximo resultado começa com um atendimento"
          }
          description={
            metric === "new_customers"
              ? "Novos cadastros com data registrada aparecerão aqui. Você também pode consultar outro período."
              : "Não há registros para este indicador no período selecionado. Altere o filtro ou abra sua agenda para começar."
          }
        />
      ) : (
        <>
          <div
            className="executive-chart-readout"
            aria-live="polite"
            aria-atomic="true"
          >
            <span>
              {active ? period(active.first, active.last) : "Período"}
            </span>
            <strong>{active?.[metric]?.toLocaleString("pt-BR") ?? 0}</strong>
            <span>{labels[metric].toLowerCase()}</span>
          </div>
          <div
            className="executive-chart-scroll"
            tabIndex={0}
            role="region"
            aria-label="Gráfico interativo. Use as setas do teclado nas barras ou deslize para ver todo o período."
          >
            <div
              className="executive-chart-bars"
              style={{
                minWidth: `${buckets.length * 44}px`,
                gridTemplateColumns: `repeat(${buckets.length}, minmax(0, 1fr))`,
              }}
            >
              {buckets.map((item, index) => {
                const count = item[metric] ?? 0;
                return (
                  <button
                    className="executive-chart-bar"
                    type="button"
                    key={item.first}
                    ref={(element) => {
                      bars.current[index] = element;
                    }}
                    tabIndex={selected === index ? 0 : -1}
                    aria-pressed={selected === index}
                    aria-label={`${period(item.first, item.last)}: ${count} ${labels[metric].toLowerCase()}`}
                    onFocus={() => setSelected(index)}
                    onClick={() => setSelected(index)}
                    onKeyDown={(event) => {
                      let next = index;
                      if (event.key === "ArrowRight")
                        next = Math.min(index + 1, buckets.length - 1);
                      else if (event.key === "ArrowLeft")
                        next = Math.max(index - 1, 0);
                      else if (event.key === "Home") next = 0;
                      else if (event.key === "End") next = buckets.length - 1;
                      else return;
                      event.preventDefault();
                      bars.current[next]?.focus();
                    }}
                  >
                    <span className="executive-bar-track" aria-hidden="true">
                      <span style={{ height: `${(count / maximum) * 100}%` }} />
                    </span>
                    <span className="executive-bar-label" aria-hidden="true">
                      {dashboardDate(item.first)}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
          <p className="executive-chart-hint">
            Toque em uma barra para ver o total.{" "}
            {daily.length > 14
              ? "Datas agrupadas em intervalos para facilitar a leitura."
              : "Cada barra representa um dia."}
          </p>
          <details className="executive-chart-data">
            <summary>Ver dados em tabela</summary>
            <div
              className="executive-data-scroll"
              tabIndex={0}
              role="region"
              aria-label="Dados diários do gráfico"
            >
              <table>
                <caption>{labels[metric]} por dia</caption>
                <thead>
                  <tr>
                    <th scope="col">Data</th>
                    <th scope="col">Total</th>
                  </tr>
                </thead>
                <tbody>
                  {daily.map((day) => (
                    <tr key={day.day}>
                      <th scope="row">{dashboardDate(day.day, true)}</th>
                      <td>{(day[metric] ?? 0).toLocaleString("pt-BR")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </details>
        </>
      )}
    </section>
  );
}
