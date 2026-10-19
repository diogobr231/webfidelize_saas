import test from "node:test";
import assert from "node:assert/strict";
import {
  articleSchema,
  filterArticles,
  helpModuleName,
  responseSchema,
  ticketSchema,
  type HelpArticle,
} from "../src/lib/help";

const article: HelpArticle = {
  id: "a",
  title: "Horários e configuração",
  module: "agenda",
  kind: "faq",
  body: "Configure os horários da equipe antes de compartilhar o link.",
  published: true,
  sort_order: 1,
  updated_at: "2026-10-18T10:00:00Z",
};
test("help search ignores case and accents and respects the selected module", () => {
  assert.equal(
    filterArticles([article], "HORARIOS configuração", "agenda").length,
    1,
  );
  assert.equal(filterArticles([article], "horarios", "equipe").length, 0);
  assert.equal(
    filterArticles([article], "horários ausente", "todos").length,
    0,
  );
  assert.equal(helpModuleName("agenda"), "Agenda e agendamento");
});
test("support request requires UUID, valid module and meaningful bounded text", () => {
  const input = {
    request_key: "00000000-0000-4000-8000-000000000001",
    module: "agenda",
    subject: "  Dúvida sobre horários  ",
    message: "Preciso de ajuda para configurar os horários.",
  };
  assert.equal(ticketSchema.parse(input).subject, "Dúvida sobre horários");
  for (const invalid of [
    { ...input, request_key: "any" },
    { ...input, module: "admin" },
    { ...input, message: "x" },
    { ...input, message: "x".repeat(4001) },
    { ...input, subject: " " },
  ])
    assert.equal(ticketSchema.safeParse(invalid).success, false);
});
test("help editor accepts plain text and validates publishing fields", () => {
  assert.equal(articleSchema.safeParse(article).success, true);
  assert.equal(
    articleSchema.safeParse({ ...article, body: "short" }).success,
    false,
  );
  assert.equal(
    articleSchema.safeParse({ ...article, kind: "script" }).success,
    false,
  );
  assert.equal(
    articleSchema.safeParse({ ...article, published: "true" }).success,
    false,
  );
  assert.equal(
    articleSchema.safeParse({ ...article, sort_order: -1 }).success,
    false,
  );
});
test("a resolved support request must have a response", () => {
  assert.equal(
    responseSchema.safeParse({ status: "resolved", response: " " }).success,
    false,
  );
  assert.equal(
    responseSchema.safeParse({
      status: "resolved",
      response: "Orientação enviada na central.",
    }).success,
    true,
  );
  assert.equal(
    responseSchema.safeParse({ status: "in_progress", response: "" }).success,
    true,
  );
  assert.equal(
    responseSchema.safeParse({ status: "active", response: "" }).success,
    false,
  );
});
