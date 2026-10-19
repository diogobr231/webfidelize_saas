import { PageSkeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <main>
      <PageSkeleton label="Carregando suas empresas…" />
    </main>
  );
}
