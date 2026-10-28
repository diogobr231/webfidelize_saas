import { AdminAiShell } from "@/components/admin-ai/shell";
import { PageSkeleton } from "@/components/ui/skeleton";
import "../admin.css";
import "./ai.css";
export default function Loading() {
  return (
    <AdminAiShell>
      <PageSkeleton label="Carregando a Central IA…" />
    </AdminAiShell>
  );
}
