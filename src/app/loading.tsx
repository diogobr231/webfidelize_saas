import { Brand } from "@/components/ui/brand";
import { PageSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main className="ui-state-page">
      <Brand />
      <PageSkeleton label="Carregando sua experiência…" />
    </main>
  );
}
