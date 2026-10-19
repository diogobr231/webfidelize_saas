import "@/components/help/help.css";
export default function LoadingHelp() {
  return (
    <div
      className="help-loading"
      role="status"
      aria-label="Carregando a central de ajuda"
    >
      <div className="help-skeleton help-skeleton-heading" />
      <div className="help-skeleton help-skeleton-search" />
      {[1, 2, 3, 4].map((item) => (
        <div key={item} className="help-skeleton help-skeleton-row" />
      ))}
      <span>Carregando orientações e solicitações…</span>
    </div>
  );
}
