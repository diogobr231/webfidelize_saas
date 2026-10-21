import { z } from "zod";
import { localAppointmentInstant, validDay } from "./scheduling";

export const BLOCKS_PAGE_SIZE = 12;
export type ScheduleBlock = {
  id: string;
  professional_id: string | null;
  starts_at: string;
  ends_at: string;
  reason: string;
};
export type ScheduleBlockValues = {
  request_id: string;
  professional_id: string;
  start_day: string;
  start_time: string;
  end_day: string;
  end_time: string;
  reason: string;
};
export type ScheduleBlockState = {
  error?: string;
  values?: ScheduleBlockValues;
  feedbackKey?: string;
};

export function blockPage(value: unknown): number {
  if (typeof value !== "string" || !/^[1-9]\d{0,5}$/.test(value)) return 1;
  return Number(value);
}

export function blockValues(form: FormData): ScheduleBlockValues {
  const field = (name: string, limit: number) => {
    const value = form.get(name);
    return typeof value === "string" ? value.slice(0, limit) : "";
  };
  return {
    request_id: field("request_id", 100),
    professional_id: field("professional_id", 100),
    start_day: field("start_day", 40),
    start_time: field("start_time", 40),
    end_day: field("end_day", 40),
    end_time: field("end_time", 40),
    reason: field("reason", 1000),
  };
}

export function parseScheduleBlock(
  values: ScheduleBlockValues,
  now = Date.now(),
) {
  if (!z.uuid().safeParse(values.request_id).success)
    return {
      success: false as const,
      error: "Atualize a página e tente novamente.",
    };
  if (
    values.professional_id &&
    !z.uuid().safeParse(values.professional_id).success
  )
    return {
      success: false as const,
      error: "Selecione um profissional disponível.",
    };
  if (!validDay(values.start_day) || !validDay(values.end_day))
    return {
      success: false as const,
      error: "Informe datas válidas para o início e o fim.",
    };
  const start = localAppointmentInstant(values.start_day, values.start_time);
  const end = localAppointmentInstant(values.end_day, values.end_time);
  if (
    !start ||
    !end ||
    Date.parse(end) <= Date.parse(start) ||
    Date.parse(end) <= now
  )
    return {
      success: false as const,
      error:
        "O fim deve ser depois do início e ainda estar no futuro. Confira os horários no fuso de São Paulo.",
    };
  const reason = values.reason.trim();
  if ([...reason].length > 160)
    return {
      success: false as const,
      error: "Use até 160 caracteres no motivo.",
    };
  return {
    success: true as const,
    data: {
      id: values.request_id,
      professional: values.professional_id || null,
      start,
      end,
      reason,
    },
  };
}

export function parseBlockRemoval(form: FormData) {
  if (form.get("confirm_action") !== "yes")
    return { success: false as const, error: "confirmar-bloqueio" };
  const id = z.uuid().safeParse(form.get("block_id"));
  return id.success
    ? { success: true as const, id: id.data }
    : { success: false as const, error: "remover-bloqueio" };
}

export function scheduleBlockError(message: string): string {
  if (message.includes("scheduled appointment conflict"))
    return "Já existe um agendamento nesse intervalo. Remarque ou cancele esse atendimento na agenda antes de criar o bloqueio. Nenhum agendamento foi alterado.";
  if (message.includes("professional unavailable"))
    return "Este profissional não está disponível. Atualize a página e selecione um profissional ativo da empresa.";
  if (message.includes("block idempotency conflict"))
    return "Este envio já foi utilizado com outros dados. Atualize a página antes de criar outro bloqueio.";
  if (message.includes("invalid block interval"))
    return "Confira o intervalo: o fim deve ser depois do início e ainda estar no futuro.";
  if (message.includes("invalid block reason"))
    return "Use até 160 caracteres no motivo.";
  return "Não foi possível salvar o bloqueio. Confira sua permissão, a assinatura e tente novamente.";
}
