import { PageSkeleton } from "@/components/ui/skeleton";
import { OperationsShell } from "@/components/admin-operations/shell";
import "../admin.css";
import "./operations.css";
export default function Loading() {
  return (
    <OperationsShell>
      <PageSkeleton label="Carregando automações e tarefas…" />
    </OperationsShell>
  );
}
