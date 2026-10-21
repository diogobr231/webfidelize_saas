import { z } from "zod";
import { resolveAuthOrigin } from "./auth-flow";
import { teamInvitationIssueSchema, type TeamInvitationIssue } from "./team";

export type InvitationDelivery =
  | "not_requested"
  | "unavailable"
  | "accepted"
  | "rejected"
  | "unknown";
export const invitationDeliveryMessages: Record<InvitationDelivery, string> = {
  not_requested:
    "Nenhum e-mail foi enviado por esta ação. Você pode compartilhar o link com o colaborador.",
  unavailable:
    "O envio por e-mail não está disponível. O convite foi salvo; compartilhe o link com o colaborador.",
  accepted:
    "O servidor de e-mail aceitou a mensagem. A chegada à caixa de entrada ainda depende do provedor; peça ao colaborador que verifique também o spam.",
  rejected:
    "O servidor de e-mail recusou a mensagem. O convite continua válido; compartilhe o link com o colaborador.",
  unknown:
    "Não foi possível confirmar o envio do e-mail. O convite continua válido; verifique a caixa de entrada ou compartilhe o link, sem gerar outro agora.",
};

const smtpSchema = z.object({
  host: z
    .string()
    .max(253)
    .regex(
      /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/,
    ),
  port: z.enum(["465", "587"]),
  user: z
    .string()
    .min(1)
    .max(320)
    .regex(/^[^\r\n\0]+$/),
  password: z.string().min(1).max(4096),
  from: z.email().max(254),
});
export function invitationMailConfig(env: Record<string, string | undefined>) {
  const result = smtpSchema.safeParse({
    host: env.TEAM_SMTP_HOST,
    port: env.TEAM_SMTP_PORT,
    user: env.TEAM_SMTP_USER,
    password: env.TEAM_SMTP_PASSWORD,
    from: env.TEAM_SMTP_FROM,
  });
  if (!result.success) return null;
  try {
    const origin = resolveAuthOrigin(env.APP_URL, true);
    return { ...result.data, port: Number(result.data.port), origin };
  } catch {
    return null;
  }
}
export type InvitationMailConfig = NonNullable<
  ReturnType<typeof invitationMailConfig>
>;

function escapeHtml(value: string) {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ]!,
  );
}
export function invitationMailMessage(
  issue: TeamInvitationIssue,
  config: InvitationMailConfig,
) {
  const parsed = teamInvitationIssueSchema.parse(issue);
  const link = `${config.origin}/convite/${parsed.token}`;
  const company = parsed.company_name.replace(/[\r\n\0]/g, " ");
  const role = parsed.role === "MANAGER" ? "gerente" : "colaborador";
  const deadline = new Intl.DateTimeFormat("pt-BR", {
    timeZone: "America/Sao_Paulo",
    dateStyle: "short",
    timeStyle: "short",
  }).format(new Date(parsed.expires_at));
  return {
    from: { name: "Web Fidelize", address: config.from },
    to: parsed.email,
    subject: `Convite para a equipe de ${company}`,
    messageId: `<invitation-${parsed.issue_id}@${config.from.split("@")[1]}>`,
    text: `Você recebeu um convite para participar de ${company} na Web Fidelize como ${role}.\n\nAbra: ${link}\n\nUse a conta ${parsed.email} com o e-mail confirmado. O convite é individual, de uso único e válido até ${deadline} (Brasília). Abrir o link não aceita o convite automaticamente.\n\nSe você não reconhece esta empresa, ignore esta mensagem.\nWeb Fidelize`,
    html: `<!doctype html><html lang="pt-BR"><body style="margin:0;padding:24px;background:#f5f7fa;color:#19212e;font-family:Arial,sans-serif"><table role="presentation" width="100%" style="max-width:560px;margin:auto;background:white;border:1px solid #e4e8ee;border-radius:16px"><tr><td style="padding:32px"><p style="font-weight:bold;color:#17674e">WEB FIDELIZE</p><h1 style="font-size:26px;line-height:1.25">Sua equipe espera por você</h1><p style="line-height:1.6">Você recebeu um convite para participar de <strong>${escapeHtml(company)}</strong> como ${role}.</p><p style="margin:28px 0"><a href="${escapeHtml(link)}" style="display:inline-block;background:#17674e;color:white;padding:14px 20px;border-radius:8px;text-decoration:none;font-weight:bold">Ver convite</a></p><p style="line-height:1.6">Use a conta <strong>${escapeHtml(parsed.email)}</strong> com o e-mail confirmado. O convite é individual, de uso único e válido até ${escapeHtml(deadline)} (Brasília). Abrir o link não aceita o convite automaticamente.</p><p style="font-size:13px;line-height:1.6;overflow-wrap:anywhere">Se o botão não funcionar, copie: ${escapeHtml(link)}</p><p style="font-size:13px;color:#586477;line-height:1.6">Se você não reconhece esta empresa, ignore esta mensagem.</p></td></tr></table></body></html>`,
    disableFileAccess: true,
    disableUrlAccess: true,
  };
}

type SendMail = (
  message: ReturnType<typeof invitationMailMessage>,
) => Promise<{ accepted?: unknown[]; rejected?: unknown[] }>;
/** SMTP acceptance is not delivery. Never retry an ambiguous result automatically. */
export async function deliverInvitation(
  issue: TeamInvitationIssue,
  config: InvitationMailConfig | null,
  sendMail: SendMail,
): Promise<InvitationDelivery> {
  if (!config) return "unavailable";
  // Synthetic fixtures must never leave the local test environment.
  if (/@(?:[^@]+\.)?(?:invalid|test|example)$/i.test(issue.email))
    return "unavailable";
  try {
    const result = await sendMail(invitationMailMessage(issue, config));
    if (result.rejected?.length) return "rejected";
    return result.accepted?.some(
      (address) =>
        typeof address === "string" &&
        address.toLowerCase() === issue.email.toLowerCase(),
    )
      ? "accepted"
      : "unknown";
  } catch {
    return "unknown";
  }
}
