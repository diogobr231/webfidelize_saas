"use client";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { PendingButton } from "@/components/pending-button";
import type {
  OperationRule,
  OperationTask,
  OperationActionState,
  OperationReturnFilters,
} from "@/lib/admin-operations";
import {
  saveAutomation,
  manageOperationTask,
  runOperations,
} from "@/app/admin/automacoes/actions";

function Feedback({ state }: { state: OperationActionState }) {
  return (
    <>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="notice" role="status">
          {state.success}
        </p>
      )}
    </>
  );
}
function ReturnFilters({ filters }: { filters: OperationReturnFilters }) {
  return (
    <>
      <input type="hidden" name="return_status" value={filters.status} />
      <input type="hidden" name="return_rule" value={filters.rule} />
      <input type="hidden" name="return_page" value={filters.page} />
    </>
  );
}
export function AutomationRuleForm({
  rule,
  thresholdLabel,
  returnFilters,
}: {
  rule: OperationRule;
  thresholdLabel: string;
  returnFilters: OperationReturnFilters;
}) {
  const [state, action] = useActionState(saveAutomation, {});
  const [enabled, setEnabled] = useState(String(rule.enabled));
  const [threshold, setThreshold] = useState(String(rule.threshold_hours));
  return (
    <form action={action} className="ops-rule-form">
      <ReturnFilters filters={returnFilters} />
      <input type="hidden" name="rule" value={rule.id} />
      <input type="hidden" name="updated_at" value={rule.updated_at} />
      <label htmlFor={`enabled-${rule.id}`}>
        Situação
        <select
          id={`enabled-${rule.id}`}
          name="enabled"
          value={enabled}
          onChange={(event) => setEnabled(event.target.value)}
        >
          <option value="true">Habilitada</option>
          <option value="false">Pausada</option>
        </select>
      </label>
      <label htmlFor={`threshold-${rule.id}`}>
        {thresholdLabel}
        <input
          id={`threshold-${rule.id}`}
          name="threshold"
          type="number"
          inputMode="numeric"
          min="1"
          max="720"
          step="1"
          required
          value={threshold}
          onChange={(event) => setThreshold(event.target.value)}
        />
      </label>
      <PendingButton className="secondary">Salvar regra</PendingButton>
      <Feedback state={state} />
    </form>
  );
}
function TaskButton({
  value,
  children,
}: {
  value: "done" | "reopen" | "snooze24h";
  children: React.ReactNode;
}) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      name="action"
      value={value}
      className="secondary"
      disabled={pending}
      aria-busy={pending}
    >
      {pending ? "Aplicando…" : children}
    </button>
  );
}
export function TaskActions({
  task,
  returnFilters,
}: {
  task: Pick<OperationTask, "id" | "updated_at" | "status">;
  returnFilters: OperationReturnFilters;
}) {
  const [state, action] = useActionState(manageOperationTask, {});
  return (
    <form action={action} className="ops-task-form">
      <ReturnFilters filters={returnFilters} />
      <input type="hidden" name="id" value={task.id} />
      <input type="hidden" name="updated_at" value={task.updated_at} />
      <div className="ops-actions">
        {task.status === "open" ? (
          <>
            <TaskButton value="done">Concluir tarefa</TaskButton>
            <TaskButton value="snooze24h">Adiar 24 horas</TaskButton>
          </>
        ) : task.status === "done" ? (
          <TaskButton value="reopen">Reabrir tarefa</TaskButton>
        ) : (
          <span className="ops-hint">
            Resolvida pela verificação das condições.
          </span>
        )}
      </div>
      <Feedback state={state} />
    </form>
  );
}
export function RunOperationsForm({
  returnFilters,
}: {
  returnFilters: OperationReturnFilters;
}) {
  const [state, action] = useActionState(runOperations, {});
  return (
    <form action={action} className="ops-run-form">
      <ReturnFilters filters={returnFilters} />
      <PendingButton pendingLabel="Verificando…">Verificar agora</PendingButton>
      <Feedback state={state} />
    </form>
  );
}
