export function PageSkeleton({
  label = "Carregando seu espaço…",
}: {
  label?: string;
}) {
  return (
    <section
      className="ui-skeleton"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      <span className="sr-only">{label}</span>
      <div aria-hidden="true">
        <div className="skeleton-line skeleton-title" />
        <div className="skeleton-line" />
        <div className="skeleton-cards">
          {[1, 2, 3].map((n) => (
            <div className="skeleton-card" key={n}>
              <div className="skeleton-line" />
              <div className="skeleton-line skeleton-value" />
            </div>
          ))}
        </div>
        <div className="skeleton-block" />
      </div>
    </section>
  );
}
