import { z } from "zod";
import type { InvitationDelivery } from "./team-mail-content";

const optionalUser = z
  .union([z.uuid(), z.literal("")])
  .transform((value) => value || null);
export const professionalMemberSchema = z.object({
  company_id: z.uuid(),
  professional_id: z.uuid(),
  member_id: optionalUser,
  expected_member_id: optionalUser,
  confirm_action: z.literal("yes").optional(),
});
export const revokeMemberSchema = z.object({
  company_id: z.uuid(),
  member_id: z.uuid(),
  confirm_action: z.literal("yes"),
});
export const teamRoleLabels: Record<string, string> = {
  OWNER: "Proprietário",
  MANAGER: "Gerente",
  EMPLOYEE: "Colaborador",
};
export function teamActionError(message: string) {
  if (message.includes("assignment version conflict"))
    return "vinculo-atualizado";
  if (message.includes("member already assigned")) return "conta-vinculada";
  if (message.includes("confirmation required")) return "confirmacao";
  return "vinculo";
}

export const teamInvitationIssueSchema = z.object({
  id: z.uuid(),
  issue_id: z.uuid(),
  token: z.string().regex(/^[a-f0-9]{64}$/),
  email: z.email().max(254),
  role: z.enum(["MANAGER", "EMPLOYEE"]),
  company_name: z.string().min(2).max(100),
  expires_at: z.iso.datetime({ offset: true }),
});
export type TeamInvitationIssue = z.infer<typeof teamInvitationIssueSchema>;
export type InvitationActionState = {
  error?: string;
  issue?: TeamInvitationIssue;
  url?: string;
  delivery?: InvitationDelivery;
};
export const createInvitationSchema = z.object({
  company_id: z.uuid(),
  email: z.string().trim().toLowerCase().pipe(z.email().max(254)),
  role: z.enum(["MANAGER", "EMPLOYEE"]),
});
export const existingInvitationSchema = z.object({
  company_id: z.uuid(),
  invitation_id: z.uuid(),
});
export const cancelInvitationSchema = existingInvitationSchema.extend({
  confirm_action: z.literal("yes"),
});
export function invitationError(message: string) {
  if (message.includes("daily invitation limit")) return "limite-convites";
  if (message.includes("invitation cooldown")) return "aguarde-convite";
  if (message.includes("pending invitation exists")) return "convite-pendente";
  if (message.includes("already a member")) return "membro-existente";
  if (message.includes("member limit")) return "limite-equipe";
  if (message.includes("subscription blocked")) return "assinatura-convite";
  if (message.includes("confirmation required")) return "confirmacao";
  if (message.includes("invitation unavailable")) return "convite-indisponivel";
  return "convite";
}
export const invitationErrorMessages: Record<string, string> = {
  convite:
    "Não foi possível gerar o convite. Confira os dados e tente novamente.",
  "limite-convites":
    "O limite de 25 emissões de convite nas últimas 24 horas foi atingido. Aguarde antes de gerar outro link.",
  "aguarde-convite":
    "Aguarde 60 segundos desde a última emissão para gerar outro link para este e-mail.",
  "convite-pendente":
    "Este e-mail já tem um convite válido. Use a lista abaixo para renovar ou cancelar o convite existente.",
  "membro-existente":
    "Esta conta já faz parte da empresa. Gerencie seu acesso na lista da equipe.",
  "limite-equipe":
    "Sua equipe atingiu o limite do plano. Revise os acessos ou escolha um plano com mais colaboradores.",
  "assinatura-convite":
    "A assinatura precisa estar liberada para gerar ou renovar convites. Você ainda pode cancelar convites pendentes.",
  confirmacao: "Confirme o cancelamento do convite antes de continuar.",
  "convite-indisponivel":
    "Este convite foi aceito, cancelado ou não está disponível nesta empresa. Atualize a página.",
};
export const INVITATION_PAGE_SIZE = 12;
export function invitationPage(value: unknown) {
  return typeof value === "string" && /^[1-9]\d{0,5}$/.test(value)
    ? Math.min(Number(value), 10000)
    : 1;
}
export function invitationStatus(
  invitation: {
    accepted_at: string | null;
    canceled_at: string | null;
    expires_at: string;
  },
  now = Date.now(),
) {
  if (invitation.accepted_at) return "Aceito";
  if (invitation.canceled_at) return "Cancelado";
  return Date.parse(invitation.expires_at) <= now ? "Expirado" : "Pendente";
}
