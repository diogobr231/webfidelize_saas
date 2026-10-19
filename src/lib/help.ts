import { z } from "zod";

export const helpModules = [
  { id: "primeiros-passos", name: "Primeiros passos", icon: "sparkles" },
  { id: "agenda", name: "Agenda e agendamento", icon: "calendar" },
  { id: "clientes", name: "Clientes", icon: "users" },
  { id: "servicos", name: "Serviços", icon: "briefcase" },
  { id: "equipe", name: "Equipe e permissões", icon: "user" },
  { id: "assinatura", name: "Planos e assinaturas", icon: "building" },
  { id: "seguranca", name: "Conta e segurança", icon: "shield" },
] as const;
export const helpModuleSchema = z.enum([
  "primeiros-passos",
  "agenda",
  "clientes",
  "servicos",
  "equipe",
  "assinatura",
  "seguranca",
]);
export type HelpModule = z.infer<typeof helpModuleSchema>;
export const ticketStatuses = {
  open: "Recebida",
  in_progress: "Em atendimento",
  resolved: "Resolvida",
} as const;
export const ticketSchema = z.object({
  request_key: z.uuid(),
  module: helpModuleSchema,
  subject: z
    .string()
    .trim()
    .min(5, "Use pelo menos 5 caracteres no assunto.")
    .max(140),
  message: z
    .string()
    .trim()
    .min(20, "Descreva sua dúvida com pelo menos 20 caracteres.")
    .max(4000),
});
export const articleSchema = z.object({
  title: z.string().trim().min(5).max(140),
  module: helpModuleSchema,
  kind: z.enum(["faq", "tutorial"]),
  body: z.string().trim().min(20).max(12000),
  published: z.boolean(),
  sort_order: z.coerce.number().int().min(0).max(1000),
});
export const responseSchema = z
  .object({
    status: z.enum(["open", "in_progress", "resolved"]),
    response: z.string().trim().max(4000),
  })
  .refine(
    (value) => value.status !== "resolved" || value.response.length >= 5,
    {
      message: "Inclua uma resposta antes de resolver a solicitação.",
      path: ["response"],
    },
  );
export type HelpArticle = {
  id: string;
  title: string;
  module: HelpModule;
  kind: "faq" | "tutorial";
  body: string;
  published: boolean;
  sort_order: number;
  updated_at: string;
};
export type SupportTicket = {
  id: string;
  company_id: string;
  requester_id: string;
  module: HelpModule;
  subject: string;
  message: string;
  status: keyof typeof ticketStatuses;
  response: string;
  created_at: string;
  updated_at: string;
};
export type HelpFormState = {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
};
export const initialHelpState: HelpFormState = {};
export function helpModuleName(value: string) {
  return helpModules.find((module) => module.id === value)?.name ?? "Ajuda";
}
const normalized = (value: string) =>
  value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
export function filterArticles(
  articles: HelpArticle[],
  query: string,
  module: string,
) {
  const terms = normalized(query.trim().slice(0, 120))
    .split(/\s+/)
    .filter(Boolean);
  return articles.filter(
    (article) =>
      (module === "todos" || article.module === module) &&
      terms.every((term) =>
        normalized(`${article.title} ${article.body}`).includes(term),
      ),
  );
}
export function helpDate(value: string) {
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "America/Sao_Paulo",
  }).format(new Date(value));
}
