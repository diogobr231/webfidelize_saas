import { PageSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <main>
      <PageSkeleton label="Carregando as opções de implantação…" />
    </main>
  );
}
