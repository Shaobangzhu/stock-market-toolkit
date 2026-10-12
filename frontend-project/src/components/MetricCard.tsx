import type { ReactNode } from 'react';

export function MetricCard({ label, value, detail, icon }: {
  label: string;
  value: string;
  detail?: string;
  icon?: ReactNode;
}) {
  return (
    <article className="metric-card">
      <div className="metric-card__top"><span>{label}</span>{icon && <span className="metric-card__icon">{icon}</span>}</div>
      <strong>{value}</strong>
      {detail && <small>{detail}</small>}
    </article>
  );
}
