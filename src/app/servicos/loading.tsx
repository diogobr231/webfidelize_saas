import { PageSkeleton } from "@/components/ui/skeleton";
import "./services.css";
export default function Loading() {
  return (
    <main className="services-site">
      <PageSkeleton
        variant="dashboard"
        label="Carregando serviços e valores…"
      />
    </main>
  );
}
