import { z } from "zod";

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
