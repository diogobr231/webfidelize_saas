"use client";

import { useActionState, useState } from "react";
import { PendingButton } from "@/components/pending-button";
import type { WhatsAppFormState } from "@/lib/whatsapp-forms";

type Action = (
  previous: WhatsAppFormState,
  form: FormData,
) => Promise<WhatsAppFormState>;
const empty: WhatsAppFormState = {};

function Feedback({ state }: { state: WhatsAppFormState }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {state.error ? (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="notice" role="status">
          {state.success}
        </p>
      ) : null}
    </div>
  );
}

export function ReminderSettingsForm({
  enabled,
  offsets,
  limit,
  writable,
  action,
  permalink,
}: {
  enabled: boolean;
  offsets: number[];
  limit: number;
  writable: boolean;
  action: Action;
  permalink: string;
}) {
  const [state, submit] = useActionState(action, empty, permalink);
  return (
    <form action={submit} className="reminder-settings">
      <fieldset disabled={!writable}>
        <legend className="sr-only">Preferências dos lembretes</legend>
        <label className="reminder-toggle">
          <input type="checkbox" name="enabled" defaultChecked={enabled} />
          <span>
            <strong>Ativar lembretes dos clientes</strong>
            <small>
              Envie somente para clientes que autorizaram o contato.
            </small>
          </span>
        </label>
        <div className="reminder-field-heading">
          <h3>Quando lembrar?</h3>
          <p>
            Defina de um a três avisos antes de cada atendimento. Cada aviso
            enviado usa uma unidade do limite.
          </p>
        </div>
        <div className="reminder-offsets">
          {[0, 1, 2].map((index) => (
            <label key={index}>
              Lembrete {index + 1}
              {index > 0 ? " (opcional)" : ""}
              <input
                name="offset_minutes"
                type="number"
                inputMode="numeric"
                min={30}
                max={10080}
                step={1}
                defaultValue={offsets[index] ?? ""}
                required={index === 0}
                aria-describedby="reminder-offset-help"
              />
              <span>minutos antes</span>
            </label>
          ))}
        </div>
        <p id="reminder-offset-help" className="reminder-help">
          Exemplos: 120 = 2 horas; 1.440 = 24 horas. Mínimo 30 minutos e máximo
          10.080 minutos (7 dias). Não repita a mesma antecedência.
        </p>
        <label className="reminder-limit">
          Seu limite mensal de mensagens
          <input
            name="monthly_limit"
            type="number"
            inputMode="numeric"
            min={0}
            max={100000}
            step={1}
            required
            defaultValue={limit}
            aria-describedby="reminder-limit-help"
          />
        </label>
        <p id="reminder-limit-help" className="reminder-help">
          Clientes e equipe compartilham este limite. Use zero para pausar todo
          o consumo. O limite efetivo será o menor entre este valor e a cota
          liberada pela Web Fidelize. Não há compra ou cobrança nesta tela.
        </p>
        {writable ? (
          <PendingButton>Salvar preferências</PendingButton>
        ) : (
          <p className="notice">
            As preferências estão em modo de consulta enquanto a empresa estiver
            sem acesso válido.
          </p>
        )}
      </fieldset>
      <Feedback state={state} />
    </form>
  );
}

export function StaffReminderSettingsForm({
  dailyEnabled,
  dailyTime,
  newAppointmentEnabled,
  writable,
  action,
  permalink,
}: {
  dailyEnabled: boolean;
  dailyTime: string;
  newAppointmentEnabled: boolean;
  writable: boolean;
  action: Action;
  permalink: string;
}) {
  const [state, submit] = useActionState(action, empty, permalink);
  return (
    <form action={submit} className="reminder-settings">
      <fieldset disabled={!writable}>
        <legend className="sr-only">Avisos da equipe no WhatsApp</legend>
        <label className="reminder-toggle">
          <input
            name="staff_daily_enabled"
            type="checkbox"
            defaultChecked={dailyEnabled}
          />
          <span>
            <strong>Resumo da agenda no começo do dia</strong>
            <small>
              Cada profissional recebe apenas os próprios atendimentos do dia,
              com horário, cliente e serviço.
            </small>
          </span>
        </label>
        <label className="reminder-limit">
          Horário do resumo diário
          <input
            name="staff_daily_time"
            type="time"
            step={60}
            defaultValue={dailyTime.slice(0, 5)}
            required
            aria-describedby="staff-daily-help"
          />
        </label>
        <p id="staff-daily-help" className="reminder-help">
          Horário de São Paulo. O processamento começa a partir deste horário.
          Dias sem atendimentos não geram resumo. Agendas longas podem ser
          divididas em mais de uma mensagem.
        </p>
        <label className="reminder-toggle">
          <input
            name="staff_new_appointment_enabled"
            type="checkbox"
            defaultChecked={newAppointmentEnabled}
          />
          <span>
            <strong>Avisar quando entrar um novo agendamento</strong>
            <small>
              Envia um aviso ao profissional responsável quando um atendimento
              futuro é criado. Alterações e remarcações não geram este aviso.
            </small>
          </span>
        </label>
        <p className="reminder-help">
          O colaborador autoriza o próprio número em Meu dia. Você não pode
          autorizar em nome dele. Os avisos da equipe usam a mesma cota mensal
          dos lembretes dos clientes.
        </p>
        {writable ? (
          <PendingButton>Salvar avisos da equipe</PendingButton>
        ) : (
          <p className="notice">
            As preferências estão em modo de consulta enquanto a empresa estiver
            sem acesso válido.
          </p>
        )}
      </fieldset>
      <Feedback state={state} />
    </form>
  );
}

export function CustomerWhatsAppConsentForm({
  allowed,
  writable,
  revocable,
  action,
  permalink,
}: {
  allowed: boolean;
  writable: boolean;
  revocable: boolean;
  action: Action;
  permalink: string;
}) {
  const [state, submit] = useActionState(action, empty, permalink);
  const [choice, setChoice] = useState(allowed ? "yes" : "no");
  if (!writable) {
    return (
      <form action={submit} className="reminder-settings">
        <input type="hidden" name="allowed" value="no" />
        <p className="reminder-help">
          Novas autorizações dependem de acesso válido e cadastro ativo.
          {revocable
            ? " A revogação continua disponível para respeitar a escolha do cliente."
            : " Este cadastro está arquivado e não recebe novos lembretes."}
        </p>
        {allowed && revocable ? (
          <PendingButton>Revogar autorização</PendingButton>
        ) : null}
        <Feedback state={state} />
      </form>
    );
  }
  return (
    <form action={submit} className="reminder-settings">
      <fieldset disabled={!writable}>
        <legend className="sr-only">
          Autorização para lembretes por WhatsApp
        </legend>
        <label>
          Preferência do cliente
          <select
            name="allowed"
            value={choice}
            onChange={(event) => setChoice(event.target.value)}
          >
            <option value="no">Não receber lembretes</option>
            <option value="yes">
              Receber lembretes no telefone do cadastro
            </option>
          </select>
        </label>
        {choice === "yes" ? (
          <label className="reminder-toggle">
            <input type="checkbox" name="attestation" required />
            <span>
              Confirmo que o cliente autorizou o recebimento de lembretes de
              agendamento pelo WhatsApp neste número.
            </span>
          </label>
        ) : null}
        {writable ? <PendingButton>Salvar autorização</PendingButton> : null}
      </fieldset>
      <Feedback state={state} />
    </form>
  );
}
