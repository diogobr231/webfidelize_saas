import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import { money } from "@/lib/catalog";
import { salesOfferColumns, type SalesOffer } from "@/lib/sales";
import { PageHeader } from "@/components/ui/page-header";
import {
  AdminSalesShell,
  SalesPagination,
} from "@/components/sales/admin-shell";
import { SalesOfferForm } from "@/components/sales/admin-forms";
import {
  salesPageNumber,
  salesPageHref,
} from "@/components/sales/admin-presenters";
import { requireSalesAdmin } from "../admin-access";
import { saveSalesOffer } from "../actions";
export const dynamic = "force-dynamic";
export default async function SalesOffers({
  searchParams,
}: {
  searchParams: Promise<{ editar?: string; pagina?: string; salvo?: string }>;
}) {
  const { db } = await requireSalesAdmin();
  const query = await searchParams,
    page = salesPageNumber(query.pagina);
  if (query.editar && !z.uuid().safeParse(query.editar).success) notFound();
  const [list, selected] = await Promise.all([
    db
      .from("sales_offers")
      .select(salesOfferColumns, { count: "exact" })
      .order("created_at", { ascending: false })
      .order("id")
      .range((page - 1) * 12, page * 12 - 1),
    query.editar
      ? db
          .from("sales_offers")
          .select(salesOfferColumns)
          .eq("id", query.editar)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
  ]);
  if (query.editar && !selected.error && !selected.data) notFound();
  const href = (p: number) =>
    salesPageHref("/admin/comercial/ofertas", {
      pagina: p,
      editar: query.editar,
    });
  if (!list.error && page > Math.max(1, Math.ceil((list.count ?? 0) / 12)))
    redirect(href(Math.max(1, Math.ceil((list.count ?? 0) / 12))));
  const offer = selected.data as SalesOffer | null;
  return (
    <AdminSalesShell current="offers">
      <PageHeader
        eyebrow="Portfólio comercial"
        title="Uma oferta para cada oportunidade."
        description="Apresente seus SaaS e serviços de implantação. Os planos da plataforma permanecem independentes."
        action={
          <Link
            className="button secondary"
            href="/admin/comercial/ofertas#editar-oferta"
          >
            Nova oferta
          </Link>
        }
      />
      {query.salvo === "1" && (
        <p className="notice" role="status">
          Oferta criada. Confira a apresentação antes de divulgar.
        </p>
      )}
      {list.error ? (
        <p className="notice error" role="alert">
          Não foi possível carregar o portfólio.
        </p>
      ) : (
        <div className="sales-offer-grid">
          {((list.data as SalesOffer[]) ?? []).map((item) => (
            <article className="panel sales-offer-card" key={item.id}>
              <span className="sales-status">
                {!item.active
                  ? "Arquivada"
                  : item.published
                    ? "Publicada"
                    : "Rascunho"}
              </span>
              <h2>{item.title}</h2>
              <p>{item.summary}</p>
              <dl>
                <dt>Implantação / projeto a partir de</dt>
                <dd>
                  {item.setup_price_cents === null
                    ? "Sob consulta"
                    : money(item.setup_price_cents)}
                </dd>
                <dt>Mensalidade a partir de</dt>
                <dd>
                  {item.monthly_price_cents === null
                    ? "Sob consulta"
                    : money(item.monthly_price_cents)}
                </dd>
              </dl>
              <div className="sales-card-actions">
                <Link
                  className="button secondary"
                  href={
                    "/admin/comercial/ofertas?editar=" +
                    item.id +
                    "#editar-oferta"
                  }
                >
                  Editar oferta
                </Link>
                {item.active && item.published && (
                  <Link
                    href={
                      "/diagnostico?produto=" + encodeURIComponent(item.slug)
                    }
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    Ver página pública ↗
                  </Link>
                )}
              </div>
            </article>
          ))}
        </div>
      )}
      <SalesPagination
        page={page}
        count={list.count ?? 0}
        pageSize={12}
        href={href}
        label="Páginas de ofertas"
      />
      <section className="panel sales-editor-panel" id="editar-oferta">
        <h2>{offer ? "Editar oferta" : "Cadastrar oferta"}</h2>
        {selected.error ? (
          <p className="notice error" role="alert">
            Não foi possível carregar a oferta selecionada.
          </p>
        ) : (
          <SalesOfferForm
            key={offer?.id ?? "new"}
            offer={offer ?? undefined}
            action={saveSalesOffer}
          />
        )}
      </section>
    </AdminSalesShell>
  );
}
