"use client";

import { useActionState, useState } from "react";
import { PendingButton } from "@/components/pending-button";
import {
  brandThemes,
  LOGO_MAX_BYTES,
  type PersonalizationState,
} from "@/lib/company-personalization";

type SaveAction = (
  state: PersonalizationState,
  form: FormData,
) => Promise<PersonalizationState>;
type CompanySettings = {
  name: string;
  booking_description?: string;
  booking_address?: string;
  booking_phone?: string;
  booking_theme?: string;
  display_density?: string;
  agenda_view?: string;
};
const empty: PersonalizationState = {};

function Feedback({ state }: { state: PersonalizationState }) {
  return (
    <div aria-live="polite" aria-atomic="true">
      {state.error ? (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      ) : null}
      {state.success ? (
        <p className="notice personalization-success" role="status">
          {state.success}
        </p>
      ) : null}
    </div>
  );
}

export function PersonalizationForm({
  company,
  saveAction,
  permalink,
}: {
  company: CompanySettings;
  saveAction: SaveAction;
  permalink: string;
}) {
  const [state, action] = useActionState(saveAction, empty, permalink);
  const [theme, setTheme] = useState(company.booking_theme || "teal");
  function fieldError(name: string) {
    return state.fields?.[name] ? (
      <span id={`${name}-error`} className="personalization-field-error">
        {state.fields[name]}
      </span>
    ) : null;
  }
  return (
    <form action={action} className="personalization-form">
      <section className="panel">
        <div className="personalization-section-heading">
          <span className="tag">01 · Empresa</span>
          <h2>Informações comerciais</h2>
          <p>
            Estes dados identificam sua empresa e aparecem na página pública
            quando ela estiver habilitada.
          </p>
        </div>
        <div className="form-grid">
          <div>
            <label htmlFor="name">Nome comercial</label>
            <input
              id="name"
              name="name"
              defaultValue={state.values?.name ?? company.name}
              required
              minLength={2}
              maxLength={100}
              autoComplete="organization"
              aria-invalid={Boolean(state.fields?.name)}
              aria-describedby={state.fields?.name ? "name-error" : undefined}
            />
            {fieldError("name")}
          </div>
          <div>
            <label htmlFor="phone">Telefone ou WhatsApp</label>
            <input
              id="phone"
              name="phone"
              type="tel"
              inputMode="tel"
              autoComplete="tel"
              defaultValue={state.values?.phone ?? company.booking_phone ?? ""}
              maxLength={24}
              placeholder="DDD + número"
              aria-invalid={Boolean(state.fields?.phone)}
              aria-describedby={state.fields?.phone ? "phone-error" : undefined}
            />
            {fieldError("phone")}
          </div>
        </div>
        <div>
          <label htmlFor="description">Apresentação da empresa</label>
          <textarea
            id="description"
            name="description"
            rows={3}
            maxLength={240}
            defaultValue={
              state.values?.description ?? company.booking_description ?? ""
            }
            placeholder="Conte brevemente o que seus clientes encontram aqui."
            aria-describedby="description-tip"
          />
          <small id="description-tip">
            Até 240 caracteres. Use informações reais sobre o seu atendimento.
          </small>
          {fieldError("description")}
        </div>
        <div>
          <label htmlFor="address">Endereço de atendimento</label>
          <input
            id="address"
            name="address"
            autoComplete="street-address"
            defaultValue={
              state.values?.address ?? company.booking_address ?? ""
            }
            maxLength={200}
            placeholder="Rua, número, bairro e cidade (opcional)"
          />
          {fieldError("address")}
        </div>
      </section>
      <section className="panel">
        <div className="personalization-section-heading">
          <span className="tag">02 · Aparência</span>
          <h2>A identidade da sua empresa</h2>
          <p>
            Escolha o destaque da página de agendamento. A marca e a navegação
            da Web Fidelize continuam consistentes para toda a equipe.
          </p>
        </div>
        <fieldset className="personalization-colors">
          <legend>Cor de destaque</legend>
          <div>
            {brandThemes.map((option) => (
              <label
                key={option.value}
                className="personalization-swatch"
                data-selected={theme === option.value}
              >
                <input
                  type="radio"
                  name="theme"
                  value={option.value}
                  checked={theme === option.value}
                  onChange={() => setTheme(option.value)}
                />
                <span
                  style={{ backgroundColor: option.color }}
                  aria-hidden="true"
                />
                <strong>{option.label}</strong>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="personalization-preview" data-theme={theme}>
          <span className="tag">Prévia de cor</span>
          <strong>{company.name}</strong>
          <p>
            A mesma experiência de agendamento, com o destaque que combina com
            seu negócio.
          </p>
          <span className="personalization-preview-button">
            Escolher horário
          </span>
        </div>
      </section>
      <section className="panel">
        <div className="personalization-section-heading">
          <span className="tag">03 · Preferências</span>
          <h2>Um espaço de trabalho confortável</h2>
          <p>
            Preferências padrão para os usuários desta empresa. Na agenda, cada
            pessoa ainda pode alternar a visualização a qualquer momento.
          </p>
        </div>
        <div className="form-grid">
          <div>
            <label htmlFor="density">Espaçamento no painel</label>
            <select
              id="density"
              name="density"
              defaultValue={
                state.values?.density ??
                company.display_density ??
                "comfortable"
              }
            >
              <option value="comfortable">
                Confortável — mais espaço entre elementos
              </option>
              <option value="compact">
                Compacto — mais informações na tela
              </option>
            </select>
          </div>
          <div>
            <label htmlFor="agenda_view">Visualização inicial da agenda</label>
            <select
              id="agenda_view"
              name="agenda_view"
              defaultValue={
                state.values?.agenda_view ?? company.agenda_view ?? "day"
              }
            >
              <option value="day">Dia</option>
              <option value="week">Semana</option>
            </select>
          </div>
        </div>
      </section>
      <Feedback state={state} />
      <div className="personalization-save">
        <span>Alterações só são aplicadas depois de salvar.</span>
        <PendingButton>Salvar personalização</PendingButton>
      </div>
    </form>
  );
}

export function LogoForm({
  saveAction,
  permalink,
  hasLogo,
  published,
  enabled,
}: {
  saveAction: SaveAction;
  permalink: string;
  hasLogo: boolean;
  published: boolean;
  enabled: boolean;
}) {
  const [state, action] = useActionState(saveAction, empty, permalink);
  const [fileError, setFileError] = useState("");
  return (
    <form
      action={action}
      className="personalization-logo-form"
      onSubmit={(event) => {
        const form = new FormData(event.currentTarget);
        if (
          fileError ||
          (form.get("remove_logo") === "on" &&
            !window.confirm(
              "Remover o logotipo desta empresa? A página usará as iniciais do nome. Você poderá enviar outra imagem depois.",
            ))
        )
          event.preventDefault();
      }}
    >
      <div>
        <label htmlFor="logo">
          {hasLogo ? "Trocar logotipo" : "Enviar logotipo"}
        </label>
        <input
          id="logo"
          name="logo"
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-describedby="logo-tip"
          onChange={(event) => {
            const file = event.currentTarget.files?.[0];
            const invalid = Boolean(
              file &&
                (file.size > LOGO_MAX_BYTES ||
                  !["image/png", "image/jpeg", "image/webp"].includes(
                    file.type,
                  )),
            );
            setFileError(
              invalid ? "Escolha PNG, JPEG ou WebP de até 750 KB." : "",
            );
            event.currentTarget.setCustomValidity(
              invalid ? "Escolha PNG, JPEG ou WebP de até 750 KB." : "",
            );
          }}
        />
        <small id="logo-tip">
          PNG, JPEG ou WebP de até 750 KB. Prefira uma imagem quadrada. SVG não
          é aceito.
        </small>
      </div>
      {fileError ? (
        <p className="personalization-field-error" role="alert">
          {fileError}
        </p>
      ) : null}
      <label className="personalization-check">
        <input
          type="checkbox"
          name="logo_published"
          defaultChecked={published}
        />
        <span>
          Exibir logotipo na página pública de agendamento
          <small>
            Somente enquanto a página estiver habilitada e a empresa tiver
            acesso ativo.
          </small>
        </span>
      </label>
      {!enabled ? (
        <p className="muted">
          A página pública está desabilitada. A imagem será exibida nela quando
          você habilitar o agendamento.
        </p>
      ) : null}
      {hasLogo ? (
        <label className="personalization-check">
          <input type="checkbox" name="remove_logo" />
          <span>
            Remover o logotipo atual
            <small>A remoção será aplicada ao salvar este formulário.</small>
          </span>
        </label>
      ) : null}
      <Feedback state={state} />
      <PendingButton>Salvar logotipo</PendingButton>
    </form>
  );
}
