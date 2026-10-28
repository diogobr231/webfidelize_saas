import assert from "node:assert/strict";
import test from "node:test";
import {
  industryOperationDefinitions,
  industryOperationPage,
  operationTransitions,
  operationsForNiche,
  parseIndustryOperationCursor,
  parseIndustryOperation,
} from "@/lib/industry-operations";

test("cursor paging returns adjacent records in both directions without skipping a boundary", () => {
  const records = Array.from({ length: 250 }, (_, index) => index + 1);
  const first = industryOperationPage(records.slice(0, 101), "after", false);
  const second = industryOperationPage(records.slice(100, 201), "after", true);
  const last = industryOperationPage(records.slice(200), "after", true);
  const back = industryOperationPage(records.slice(99, 200).reverse(), "before", true);
  const backToFirst = industryOperationPage(records.slice(0, 100).reverse(), "before", true);
  assert.deepEqual(first.rows, records.slice(0, 100));
  assert.deepEqual(second.rows, records.slice(100, 200));
  assert.deepEqual(back.rows, second.rows);
  assert.deepEqual(backToFirst.rows, first.rows);
  assert.equal(first.hasPrevious, false);
  assert.equal(last.hasNext, false);
  assert.equal(back.hasPrevious, true);
  assert.equal(back.hasNext, true);
  assert.equal(backToFirst.hasPrevious, false);
  assert.equal(backToFirst.hasNext, true);
});

function form(values: Record<string, string>) {
  const result = new FormData();
  for (const [key, value] of Object.entries(values)) result.set(key, value);
  return result;
}

test("every supported non-clinical niche has bounded operational modules", () => {
  for (const [niche, operations] of Object.entries(
    industryOperationDefinitions,
  )) {
    assert.ok(operations.length > 0, niche);
    assert.ok(
      operations.every((operation) => operation.kind && operation.label),
      niche,
    );
  }
  assert.equal(operationsForNiche("clinica").length, 0);
  assert.equal(operationsForNiche("unknown").length, 0);
});

test("operation cursor accepts only complete timestamps, UUIDs and directions", () => {
  const cursor = {
    createdAt: "2026-10-23T10:30:00.123456+00:00",
    id: "f15411d5-8a34-4b84-b84f-77b45e97a8b0",
    direction: "before",
  };
  assert.deepEqual(
    parseIndustryOperationCursor(cursor.createdAt, cursor.id, cursor.direction),
    cursor,
  );
  assert.equal(
    parseIndustryOperationCursor("2026-10-23", cursor.id, "before"),
    null,
  );
  assert.equal(
    parseIndustryOperationCursor(cursor.createdAt, "other-company", "before"),
    null,
  );
  assert.equal(
    parseIndustryOperationCursor(cursor.createdAt, cursor.id, "sideways"),
    null,
  );
});

test("restaurant table capacity and initial order lifecycle are validated", () => {
  const table = parseIndustryOperation(
    form({
      kind: "restaurant_table",
      name: "Mesa 4",
      capacity: "4",
    }),
    "restaurante",
  );
  assert.equal(table?.quantity, 4);
  assert.equal(table?.status, "available");
  assert.equal(
    parseIndustryOperation(
      form({
        kind: "restaurant_table",
        name: "Mesa 4",
        capacity: "51",
      }),
      "restaurante",
    ),
    null,
  );
  const order = parseIndustryOperation(
    form({
      kind: "restaurant_order",
      name: "Comanda 8",
      reference: "Mesa 4",
      details: "2 sucos",
      amount: "20,00",
      due: "2026-10-28T12:30",
      related_operation_id: "b5e2ef44-aeaf-4b68-89c6-80dca85a4ee6",
    }),
    "restaurante",
  );
  assert.equal(order?.amount_cents, 2000);
  assert.equal(order?.status, "open");
});

test("maps, contacts and operational quantities reject malformed values", () => {
  const invalidMap = parseIndustryOperation(
    form({
      kind: "logistics_delivery",
      name: "Pedido 14",
      reference: "Cliente",
      phone: "11987654321",
      details: "Pacote",
      due: "2026-10-28T12:30",
      location: "https://maps.app.goo.gl.evil.example/x",
    }),
    "logistica",
  );
  assert.equal(invalidMap, null);
  const safeMap = parseIndustryOperation(
    form({
      kind: "logistics_delivery",
      name: "Pedido 14",
      reference: "Cliente",
      phone: "(11) 98765-4321",
      details: "Pacote",
      due: "2026-10-28T12:30",
      location: "https://maps.app.goo.gl/AbCd123",
    }),
    "logistica",
  );
  assert.equal(safeMap?.phone, "11987654321");
  assert.equal(safeMap?.location_url, "https://maps.app.goo.gl/AbCd123");
  assert.equal(
    parseIndustryOperation(
      form({
        kind: "pet_stock",
        name: "Ração",
        reference: "Alimento",
        quantity: "-1",
        unit: "kg",
      }),
      "pet-shop",
    ),
    null,
  );
});

test("form cannot create an operation from another segment and lifecycle is sequential", () => {
  assert.equal(
    parseIndustryOperation(
      form({
        kind: "pet_profile",
        name: "Bidu",
        reference: "Ana",
      }),
      "restaurante",
    ),
    null,
  );
  assert.deepEqual(operationTransitions("restaurant_order", "open"), [
    "preparing",
    "cancelled",
  ]);
  assert.deepEqual(operationTransitions("restaurant_order", "served"), [
    "paid",
  ]);
  assert.deepEqual(operationTransitions("restaurant_order", "paid"), []);
  assert.deepEqual(operationTransitions("salon_commission", "pending"), [
    "paid",
    "cancelled",
  ]);
});

test("cash direction, contact details and São Paulo dates are normalized safely", () => {
  const cash = parseIndustryOperation(
    form({
      kind: "salon_cash",
      name: "Venda 10",
      reference: "entrada",
      amount: "45,90",
    }),
    "salao",
  );
  assert.equal(cash?.reference, "entrada");
  assert.equal(cash?.amount_cents, 4590);
  assert.equal(
    parseIndustryOperation(
      form({
        kind: "salon_cash",
        name: "Venda 10",
        reference: "qualquer coisa",
        amount: "45,90",
      }),
      "salao",
    ),
    null,
  );
  assert.equal(
    parseIndustryOperation(
      form({
        kind: "delivery",
        name: "Entrega 14",
        reference: "Cliente",
        phone: "telefone 11987654321",
        due: "2026-10-28T12:30",
      }),
      "fornecedores",
    ),
    null,
  );
  assert.equal(
    parseIndustryOperation(
      form({
        kind: "office_task",
        name: "Prazo",
        reference: "Cliente",
        due: "2026-02-30T12:30",
      }),
      "escritorio",
    ),
    null,
  );
});

test("orders, routes and pet visits require a relation; deliveries may be unassigned", () => {
  const base = {
    kind: "restaurant_order",
    name: "Comanda 30",
    details: "Café",
    amount: "12,00",
    due: "2026-10-28T12:30",
  };
  assert.equal(parseIndustryOperation(form(base), "restaurante"), null);
  const tableId = "b5e2ef44-aeaf-4b68-89c6-80dca85a4ee6";
  const order = parseIndustryOperation(
    form({ ...base, related_operation_id: tableId }),
    "restaurante",
  );
  assert.equal(order?.related_operation_id, tableId);
  const delivery = parseIndustryOperation(
    form({
      kind: "logistics_delivery",
      name: "Entrega 4",
      reference: "Cliente",
      phone: "11987654321",
      due: "2026-10-28T12:30",
    }),
    "logistica",
  );
  assert.equal(delivery?.related_operation_id, null);
});
