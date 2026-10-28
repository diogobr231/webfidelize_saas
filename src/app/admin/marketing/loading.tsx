import { PageSkeleton } from "@/components/ui/skeleton";
export default function Loading() {
  return (
    <div className="admin-content">
      <PageSkeleton label="Carregando campanhas e editor…" variant="form" />
    </div>
  );
}
