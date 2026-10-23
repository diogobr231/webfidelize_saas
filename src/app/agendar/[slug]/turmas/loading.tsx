import { PageSkeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <main className="ui-state-page">
      <PageSkeleton label="Consultando atividades e vagas disponíveis…" />
    </main>
  );
}
