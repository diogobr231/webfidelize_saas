import { PageHeader } from "@/components/ui/page-header";
import { AdminSalesShell } from "@/components/sales/admin-shell";
import { SalesLeadForm } from "@/components/sales/admin-forms";
import { type SalesOffer } from "@/lib/sales";
import { requireSalesAdmin } from "../admin-access";
import { saveSalesLead } from "../actions";
export const dynamic = "force-dynamic";
export default async function NewSalesLead() {
  const { db } = await requireSalesAdmin();
  const { data, error } = await db
    .from("sales_offers")
    .select("id,title,active")
    .eq("active", true)
    .order("title")
    .limit(200);
  return (
    <AdminSalesShell>
      <PageHeader
        eyebrow="Nova oportunidade"
        title="Comece pela conversa."
        description="Cadastre o contato e complete a qualificação conforme a negociação avança."
      />
      <section className="panel sales-editor-panel">
        {error ? (
          <p className="notice error" role="alert">
            Não foi possível carregar as ofertas.
          </p>
        ) : !data?.length ? (
          <p>Crie uma oferta ativa antes de cadastrar contatos.</p>
        ) : (
          <SalesLeadForm
            offers={data as Pick<SalesOffer, "id" | "title" | "active">[]}
            action={saveSalesLead}
          />
        )}
      </section>
    </AdminSalesShell>
  );
}
