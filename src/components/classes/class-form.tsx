"use client";

import { useActionState, useId, useState } from "react";
import { PendingButton } from "@/components/pending-button";
import { appointmentTime, saoPauloDay } from "@/lib/scheduling";
import type { ClassChoice, ClassFormState, ClassSession } from "@/lib/classes";

export type ClassAction = (
  previous: ClassFormState,
  form: FormData,
) => Promise<ClassFormState>;
const initial: ClassFormState = {};
export function ClassForm({
  action,
  services,
  professionals,
  session,
  day,
}: {
  action: ClassAction;
  services: ClassChoice[];
  professionals: ClassChoice[];
  session?: ClassSession;
  day: string;
}) {
  const [state, submit] = useActionState(action, initial);
  const [selectedService, setSelectedService] = useState(
    session?.service_id || "",
  );
  const id = useId();
  const service = services.find((item) => item.id === selectedService);
  const duration =
    session && selectedService === session.service_id
      ? Math.round(
          (Date.parse(session.ends_at) - Date.parse(session.starts_at)) /
            60_000,
        )
      : service?.duration_minutes;
  return (
    <form
      action={submit}
      className="class-form"
      onReset={(event) => event.preventDefault()}
    >
      {session && (
        <input type="hidden" name="version" value={session.version} />
      )}
      <div className="class-form-grid">
        <label htmlFor={`${id}-title`} className="class-span">
          Nome da turma
          <input
            id={`${id}-title`}
            name="title"
            defaultValue={session?.title || ""}
            required
            minLength={2}
            maxLength={120}
            placeholder="Ex.: atividade em grupo, aula ou encontro"
            aria-invalid={Boolean(state.fields?.title)}
          />
        </label>
        <label htmlFor={`${id}-service`}>
          Serviço
          <select
            id={`${id}-service`}
            name="service"
            value={selectedService}
            onChange={(event) => setSelectedService(event.target.value)}
            required
          >
            <option value="">Escolha um serviço</option>
            {services.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
                {item.archived_at ? " · arquivado" : ""}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-professional`}>
          Profissional
          <select
            id={`${id}-professional`}
            name="professional"
            defaultValue={session?.professional_id || ""}
            required
          >
            <option value="">Escolha o responsável</option>
            {professionals.map((item) => (
              <option value={item.id} key={item.id}>
                {item.name}
                {item.archived_at ? " · arquivado" : ""}
              </option>
            ))}
          </select>
        </label>
        <label htmlFor={`${id}-day`}>
          Data
          <input
            id={`${id}-day`}
            type="date"
            name="day"
            defaultValue={
              session ? saoPauloDay(new Date(session.starts_at)) : day
            }
            required
            min={saoPauloDay()}
            max="2099-12-31"
          />
        </label>
        <label htmlFor={`${id}-time`}>
          Horário de início
          <input
            id={`${id}-time`}
            type="time"
            name="time"
            defaultValue={
              session ? appointmentTime(session.starts_at) : "09:00"
            }
            required
          />
        </label>
        <label htmlFor={`${id}-capacity`}>
          Vagas
          <input
            id={`${id}-capacity`}
            type="number"
            inputMode="numeric"
            name="capacity"
            min={1}
            max={100}
            step={1}
            defaultValue={session?.capacity ?? 10}
            required
          />
        </label>
        <div className="class-duration" aria-live="polite">
          <span>Duração</span>
          <strong>
            {duration ? `${duration} minutos` : "Selecione o serviço"}
          </strong>
          <small>
            {session
              ? "Mantida ao editar o mesmo serviço."
              : "Definida pelo serviço escolhido."}
          </small>
        </div>
      </div>
      <p className="class-help">
        Horários de São Paulo. A turma respeita os turnos do profissional e
        bloqueia esse intervalo para atendimentos individuais e outras turmas.
      </p>
      <label className="class-checkbox">
        <input
          type="checkbox"
          name="is_public"
          defaultChecked={session?.is_public ?? false}
        />
        <span>
          Abrir inscrições na página pública da empresa
          <small>
            A página de agendamento precisa estar habilitada. Os visitantes veem
            apenas as vagas disponíveis.
          </small>
        </span>
      </label>
      {state.error && (
        <p role="alert" className="notice error">
          {state.error}
        </p>
      )}
      <PendingButton>
        {session ? "Salvar alterações" : "Criar turma"}
      </PendingButton>
    </form>
  );
}
