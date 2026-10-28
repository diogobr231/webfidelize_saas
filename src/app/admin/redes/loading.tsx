import { PageSkeleton } from "@/components/ui/skeleton";
import "../admin.css";
import "./social.css";
export default function Loading() {
  return (
    <main className="admin-shell social-page">
      <div className="admin-content">
        <PageSkeleton
          variant="form"
          label="Carregando empresa, posts e conexões…"
        />
      </div>
    </main>
  );
}
