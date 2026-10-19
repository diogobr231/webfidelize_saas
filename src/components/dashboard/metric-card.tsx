import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/icon";

export function MetricCard({
  label,
  value,
  detail,
  icon,
  trend,
  unavailable = false,
}: {
  label: string;
  value: ReactNode;
  detail: string;
  icon: IconName;
  trend?: ReactNode;
  unavailable?: boolean;
}) {
  return (
    <article
      className={`executive-metric card${unavailable ? " is-unavailable" : ""}`}
    >
      <div className="executive-metric-heading">
        <h2>{label}</h2>
        <span className="executive-icon">
          <Icon name={icon} size={18} />
        </span>
      </div>
      <strong className="executive-value">{value}</strong>
      <p>{detail}</p>
      {trend && <div className="executive-metric-footer">{trend}</div>}
    </article>
  );
}
