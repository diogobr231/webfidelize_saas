import Link from "next/link";
import {
  dashboardDate,
  dashboardPresets,
  type DashboardRange,
} from "@/lib/dashboard";
import { Icon } from "@/components/ui/icon";

export function PeriodFilter({
  companyId,
  range,
  today,
}: {
  companyId: string;
  range: DashboardRange;
  today: string;
}) {
  const action = `/painel/${companyId}`;
  return (
    <section className="executive-period" aria-label="Período dos indicadores">
      <nav className="executive-period-presets" aria-label="Períodos rápidos">
        {dashboardPresets.map((preset) => (
          <Link
            key={preset.value}
            href={`${action}?periodo=${preset.value}`}
            aria-current={range.period === preset.value ? "true" : undefined}
          >
            {preset.label}
          </Link>
        ))}
      </nav>
      <details
        className="executive-custom-period"
        open={range.period === "personalizado" || undefined}
      >
        <summary>
          <Icon name="calendar" size={16} /> Personalizar período{" "}
          <Icon name="chevron-down" size={14} />
        </summary>
        <form action={action} method="get">
          <input type="hidden" name="periodo" value="personalizado" />
          <label>
            Data inicial
            <input
              type="date"
              name="inicio"
              defaultValue={range.start}
              min="1900-01-01"
              max={today}
              required
            />
          </label>
          <label>
            Data final
            <input
              type="date"
              name="fim"
              defaultValue={range.end}
              min="1900-01-01"
              max={today}
              required
            />
          </label>
          <button className="button" type="submit">
            Aplicar período
          </button>
          <p>
            Até 90 dias, incluindo a data inicial e a final. Hoje:{" "}
            {dashboardDate(today)}.
          </p>
        </form>
      </details>
    </section>
  );
}
