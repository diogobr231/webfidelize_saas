import { PageSkeleton } from "@/components/ui/skeleton";
import "./admin.css";
export default function Loading() {
  return (
    <main className="admin-shell">
      <div className="admin-content">
        <PageSkeleton label="Carregando a administração…" />
      </div>
    </main>
  );
}
