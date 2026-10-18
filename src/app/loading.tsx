import { Brand } from "@/components/ui/brand";

export default function Loading() {
  return (
    <main className="ui-state-page" role="status" aria-live="polite">
      <Brand />
      <span className="ui-spinner" aria-hidden="true" />
      <p>Carregando sua experiência…</p>
    </main>
  );
}
