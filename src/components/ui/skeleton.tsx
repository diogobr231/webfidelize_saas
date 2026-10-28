export function PageSkeleton({
  label = "Carregando seu espaço…",
  variant = "dashboard",
}: {
  label?: string;
  variant?: "dashboard" | "table" | "form";
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
        {variant === "table" ? (
          <div className="skeleton-table">
            {[1, 2, 3, 4, 5].map((row) => (
              <div className="skeleton-row" key={row}>
                <div className="skeleton-line" />
                <div className="skeleton-line" />
                <div className="skeleton-line" />
              </div>
            ))}
          </div>
        ) : variant === "form" ? (
          <div className="skeleton-fields">
            {[1, 2, 3, 4].map((field) => (
              <div className="skeleton-block" key={field} />
            ))}
          </div>
        ) : (
          <>
            <div className="skeleton-cards">
              {[1, 2, 3].map((n) => (
                <div className="skeleton-card" key={n}>
                  <div className="skeleton-line" />
                  <div className="skeleton-line skeleton-value" />
                </div>
              ))}
            </div>
            <div className="skeleton-block" />
          </>
        )}
      </div>
      <progress className="ui-loading-progress" aria-label={label} />
    </section>
  );
}
