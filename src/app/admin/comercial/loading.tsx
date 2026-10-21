import { AdminSalesShell } from "@/components/sales/admin-shell";
import { PageSkeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <AdminSalesShell>
      <PageSkeleton label="Carregando a central comercial…" />
    </AdminSalesShell>
  );
}
