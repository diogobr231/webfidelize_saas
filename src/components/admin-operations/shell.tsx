import { AdminNavigation } from "@/components/admin/navigation";

export function OperationsShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="admin-shell ops-shell">
      <AdminNavigation current="tasks" />
      <div className="admin-content">{children}</div>
    </main>
  );
}
