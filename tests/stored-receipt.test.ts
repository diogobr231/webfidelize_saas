import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { StoredReceipt } from "../src/components/booking/stored-receipt";
import type { BookingReceipt } from "../src/lib/booking-receipt";
import type { ClassReceipt } from "../src/lib/classes";

const individual: BookingReceipt = {
  id: "00000000-0000-4000-8000-000000000011",
  service_name: "Serviço fictício",
  professional_name: "Profissional fictício",
  starts_at: "2026-11-01T13:00:00Z",
  ends_at: "2026-11-01T14:00:00Z",
  status: "scheduled",
};
const group: ClassReceipt = {
  registration_id: "00000000-0000-4000-8000-000000000012",
  class_id: "00000000-0000-4000-8000-000000000013",
  company_name: "Empresa fictícia",
  title: "Turma fictícia",
  service_name: individual.service_name,
  professional_name: individual.professional_name,
  starts_at: individual.starts_at,
  ends_at: individual.ends_at,
  status: "reserved",
  class_status: "scheduled",
};
const render = (receipt: BookingReceipt | ClassReceipt, calendarUrl?: string) =>
  renderToStaticMarkup(createElement(StoredReceipt, { receipt, calendarUrl }));

test("closed-catalog receipt shows stored details without booking forms or catalog links", () => {
  const html = render(
    individual,
    "/agendar/empresa-ficticia/calendario?recibo=synthetic",
  );
  assert.match(html, /Seu agendamento está confirmado/);
  assert.match(html, /Novas reservas online estão indisponíveis/);
  assert.match(html, /10:00.*11:00/);
  assert.match(html, /Salvar no calendário/);
  assert.doesNotMatch(
    html,
    /<form|<input|<img|Consultar turmas|Escolher.*serviço/,
  );
});

test("canceled individual receipt cannot present success or a calendar action", () => {
  const html = render(
    { ...individual, status: "canceled" },
    "/agendar/empresa/calendario",
  );
  assert.match(html, /Agendamento cancelado/);
  assert.doesNotMatch(html, /está confirmado|Salvar no calendário|calendario/);
});

test("class cancellation overrides attendance and completed-class labels", () => {
  for (const receipt of [
    {
      ...group,
      status: "canceled" as const,
      class_status: "completed" as const,
    },
    {
      ...group,
      status: "attended" as const,
      class_status: "canceled" as const,
    },
  ]) {
    const html = render(receipt);
    assert.match(html, /Inscrição cancelada/);
    assert.doesNotMatch(
      html,
      /está confirmada|Presença registrada|Atividade concluída/,
    );
  }
  assert.match(render({ ...group, status: "attended" }), /Presença registrada/);
  assert.match(
    render({ ...group, class_status: "completed" }),
    /Atividade concluída/,
  );
});

test("receipt details are escaped as text, including names from tenant data", () => {
  const html = render({
    ...individual,
    service_name: "<script>bad()</script>",
  });
  assert.match(html, /&lt;script&gt;bad\(\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script/);
});
