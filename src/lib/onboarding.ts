import { z } from "zod";

export type SetupStep = "empresa" | "servicos" | "equipe" | "resumo";
export type SetupActionState = {
  error?: string;
  fields?: Record<string, string>;
  values?: Record<string, string>;
};
export const initialSetupState: SetupActionState = {};

export function setupProgress(
  company: boolean,
  services: number,
  professionals: number,
) {
  const completed = [
    company,
    company && services > 0,
    company && professionals > 0,
  ];
  const done = completed.filter(Boolean).length;
  const next: SetupStep = !company
    ? "empresa"
    : services < 1
      ? "servicos"
      : professionals < 1
        ? "equipe"
        : "resumo";
  return {
    completed,
    done,
    total: 3,
    percent: Math.round((done / 3) * 100),
    next,
  };
}

export function setupStep(value: unknown, fallback: SetupStep): SetupStep {
  return typeof value === "string" &&
    ["empresa", "servicos", "equipe", "resumo"].includes(value)
    ? (value as SetupStep)
    : fallback;
}

export function setupDestination(
  companyId: string,
  step: SetupStep,
  pause = false,
) {
  return pause
    ? `/painel/${companyId}?configuracao=pausada`
    : `/painel/${companyId}/configuracao?etapa=${step}`;
}

export const setupServiceSchema = z.object({
  record_id: z.uuid("Atualize a página para iniciar um novo cadastro."),
  name: z
    .string("Informe o nome do serviço.")
    .trim()
    .min(2, "Informe pelo menos 2 caracteres.")
    .max(120, "Use até 120 caracteres."),
  duration: z.coerce
    .number({ error: "Informe a duração em minutos." })
    .int("Use um número inteiro de minutos.")
    .min(5, "Use de 5 a 480 minutos.")
    .max(480, "Use de 5 a 480 minutos."),
  price: z
    .string("Informe o preço em reais.")
    .trim()
    .regex(/^\d{1,6}(?:[.,]\d{1,2})?$/, "Informe o valor, por exemplo 50,00.")
    .transform((value) => Math.round(Number(value.replace(",", ".")) * 100))
    .refine((cents) => cents <= 10000000, "O valor máximo é R$ 100.000,00."),
});
export const setupProfessionalSchema = z.object({
  record_id: z.uuid("Atualize a página para iniciar um novo cadastro."),
  name: z
    .string("Informe o nome do profissional.")
    .trim()
    .min(2, "Informe pelo menos 2 caracteres.")
    .max(120, "Use até 120 caracteres."),
});

export function serviceHint(niche: string) {
  const hints: Record<string, string> = {
    salao:
      "Exemplo de nome: Corte de cabelo. Use a duração e o valor que você pratica.",
    "pet-shop":
      "Exemplo de nome: Banho e tosa. Cadastre apenas os serviços que você oferece.",
    clinica:
      "Exemplo de nome: Consulta. Este cadastro organiza a agenda; não contém prontuário.",
    escritorio:
      "Exemplo de nome: Reunião de atendimento. O preço pode ser zero quando não houver cobrança.",
  };
  return (
    hints[niche] ||
    "Cadastre um atendimento com hora marcada. Os módulos específicos do segmento continuam em planejamento."
  );
}
