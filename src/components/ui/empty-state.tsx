import type { ReactNode } from "react";
import { Icon, type IconName } from "./icon";

export function EmptyState({
  title,
  description,
  icon = "layout",
  children,
}: {
  title: string;
  description?: string;
  icon?: IconName;
  children?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      <span className="ui-empty-icon">
        <Icon name={icon} size={24} />
      </span>
      <h3>{title}</h3>
      {description && <p>{description}</p>}
      {children && <div className="ui-empty-actions">{children}</div>}
    </div>
  );
}
