import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { z } from "zod";
import {
  salesStages,
  normalizeSalesPhone,
  type SalesLead,
  type SalesOffer,
  type SalesActivity,
} from "@/lib/sales";
import {
  AdminSalesShell,
  SalesPagination,
} from "@/components/sales/admin-shell";
import { SalesLeadForm, SalesNoteForm } from "@/components/sales/admin-forms";
import {
  salesDate,
  salesLabel,
  salesActivityLabel,
  salesPageNumber,
  SALES_HISTORY_PAGE_SIZE,
} from "@/components/sales/admin-presenters";
import { PageHeader } from "@/components/ui/page-header";
import { requireSalesAdmin } from "../admin-access";
import { saveSalesLead, addSalesNote } from "../actions";
export const dynamic = "force-dynamic";
export default async function SalesLeadDetail({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ historico?: string; salvo?: string }>;
}) {
  const { db } = await requireSalesAdmin();
  const { id } = await params;
  if (!z.uuid().safeParse(id).success) notFound();
  const query = await searchParams,
    page = salesPageNumber(query.historico);
  const [record, offerList, activities] = await Promise.all([
    db.from("sales_leads").select("*").eq("id", id).maybeSingle(),
    db.from("sales_offers").select("id,title,active").order("title").limit(200),
    db
      .from("sales_activities")
      .select("id,lead_id,actor_id,kind,body,created_at", { count: "exact" })
      .eq("lead_id", id)
      .order("created_at", { ascending: false })
      .order("id")
      .range(
        (page - 1) * SALES_HISTORY_PAGE_SIZE,
        page * SALES_HISTORY_PAGE_SIZE - 1,
      ),
  ]);
  if (record.error)
    return (
      <AdminSalesShell>
        <p className="notice error" role="alert">
          Não foi possível carregar o contato. Tente novamente.
        </p>
      </AdminSalesShell>
    );
  if (!record.data) notFound();
  const lead = record.data as SalesLead,
    offers = (offerList.data ?? []) as Pick<
      SalesOffer,
      "id" | "title" | "active"
    >[];
  let offerError = Boolean(offerList.error);
  if (!offers.some((o) => o.id === lead.offer_id)) {
    const selected = await db
      .from("sales_offers")
      .select("id,title,active")
      .eq("id", lead.offer_id)
      .single();
    if (selected.data) offers.push(selected.data);
    else offerError = true;
  }
  const historyHref = (p: number) =>
    "/admin/comercial/" + id + "?historico=" + p + "#historico";
  const historyPages = Math.max(
    1,
    Math.ceil((activities.count ?? 0) / SALES_HISTORY_PAGE_SIZE),
  );
  if (!activities.error && page > historyPages)
    redirect(historyHref(historyPages));
  const phone = normalizeSalesPhone(lead.phone);
  return (
    <AdminSalesShell>
      <Link className="sales-inline-link" href="/admin/comercial">
        ← Voltar ao funil
      </Link>
      <PageHeader
        eyebrow={salesLabel(salesStages, lead.stage)}
        title={lead.company_name}
        description={
          lead.contact_name +
          " · " +
          (offers.find((o) => o.id === lead.offer_id)?.title ??
            "Oferta vinculada")
        }
        action={
          phone ? (
            <a
              className="button secondary"
              href={"https://wa.me/" + phone}
              target="_blank"
              rel="noopener noreferrer"
            >
              Abrir WhatsApp ↗
            </a>
          ) : undefined
        }
      />
      {query.salvo === "1" && (
        <p className="notice" role="status">
          Contato cadastrado.
        </p>
      )}
      <div className="sales-detail-layout">
        <section className="panel sales-editor-panel">
          <h2>Contato e negociação</h2>
          {offerError ? (
            <p className="notice error" role="alert">
              Não foi possível carregar as ofertas. Recarregue antes de editar.
            </p>
          ) : (
            <SalesLeadForm lead={lead} offers={offers} action={saveSalesLead} />
          )}
        </section>
        <aside className="sales-detail-aside">
          <section className="panel sales-origin">
            <h2>Origem e autorização</h2>
            <dl>
              <dt>Origem</dt>
              <dd>
                {lead.source === "site"
                  ? "Formulário do site"
                  : "Cadastro manual"}
              </dd>
              <dt>Recebido em</dt>
              <dd>{salesDate(lead.created_at)}</dd>
              <dt>Autorização de contato</dt>
              <dd>
                {lead.consent_at
                  ? "Registrada em " + salesDate(lead.consent_at)
                  : "Não registrada"}
              </dd>
              <dt>Campanha / origem / meio</dt>
              <dd>
                {[lead.utm_campaign, lead.utm_source, lead.utm_medium]
                  .filter(Boolean)
                  .join(" / ") || "Não informado"}
              </dd>
              {lead.closed_at && (
                <>
                  <dt>Encerrado comercialmente</dt>
                  <dd>{salesDate(lead.closed_at)}</dd>
                </>
              )}
            </dl>
          </section>
          <section className="panel sales-history" id="historico">
            <h2>Histórico da negociação</h2>
            <SalesNoteForm leadId={id} action={addSalesNote} />
            {activities.error ? (
              <p className="notice error" role="alert">
                Não foi possível carregar o histórico.
              </p>
            ) : (
              <ol>
                {((activities.data as SalesActivity[]) ?? []).map((item) => (
                  <li key={item.id}>
                    <strong>{salesActivityLabel(item.kind)}</strong>
                    <time dateTime={item.created_at}>
                      {salesDate(item.created_at)}
                    </time>
                    <p>
                      {item.kind === "stage_changed"
                        ? item.body.replace(
                            /\b(new|qualified|discovery|proposal|negotiation|won|lost)\b/g,
                            (stage) => salesLabel(salesStages, stage),
                          )
                        : item.body}
                    </p>
                  </li>
                ))}
              </ol>
            )}
            <SalesPagination
              page={page}
              count={activities.count ?? 0}
              pageSize={SALES_HISTORY_PAGE_SIZE}
              href={historyHref}
              label="Páginas do histórico"
            />
          </section>
        </aside>
      </div>
    </AdminSalesShell>
  );
}
