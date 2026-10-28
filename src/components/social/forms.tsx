"use client";
import dynamic from "next/dynamic";
import {
  useActionState,
  useCallback,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useFormStatus } from "react-dom";
import { saveSocialPost, type SocialState } from "@/app/admin/redes/actions";
import {
  socialWallClock,
  socialZones,
  type SocialAccount,
  type SocialPost,
} from "@/lib/social/core";
import { Icon } from "@/components/ui/icon";
import { SocialPhoto } from "./photo";
const PhotoInput = dynamic(() => import("./photo-input"), {
  ssr: false,
  loading: () => (
    <div className="social-photo-preview skeleton-block" role="status">
      Carregando editor de foto…
    </div>
  ),
});
type Action = (previous: SocialState, form: FormData) => Promise<SocialState>;
function Feedback({ state }: { state: SocialState }) {
  return (
    <>
      {state.error && (
        <p className="social-error" role="alert">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="social-success" role="status">
          {state.success}
        </p>
      )}
    </>
  );
}
export function SocialSubmit({
  children,
  pendingLabel = "Salvando…",
  disabled = false,
}: {
  children: ReactNode;
  pendingLabel?: string;
  disabled?: boolean;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} aria-busy={pending}>
      <Icon name={pending ? "clock" : "check"} size={17} />
      <span aria-live="polite">{pending ? pendingLabel : children}</span>
    </button>
  );
}
export function SocialAction({
  action,
  children,
}: {
  action: Action;
  children: ReactNode;
}) {
  const [state, submit, pending] = useActionState(action, {});
  return (
    <form action={submit} className="social-form" aria-busy={pending}>
      <Feedback state={state} />
      <fieldset disabled={pending}>{children}</fieldset>
    </form>
  );
}
export function PostEditor({
  companyId,
  postId,
  post,
  accounts,
}: {
  companyId: string;
  postId: string;
  post?: SocialPost;
  accounts: SocialAccount[];
}) {
  const [photo, setPhoto] = useState<File | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  const preparePhoto = useCallback((file: File | null) => {
    if (fileInput.current) {
      const transfer = new DataTransfer();
      if (file) transfer.items.add(file);
      fileInput.current.files = transfer.files;
    }
    setPhoto(file);
  }, []);
  const [state, submit, pending] = useActionState(saveSocialPost, {});
  return (
    <form action={submit} className="social-form" aria-busy={pending}>
      <Feedback state={state} />
      <input
        type="file"
        name="photo"
        ref={fileInput}
        hidden
        tabIndex={-1}
        aria-hidden="true"
      />
      <input type="hidden" name="id" value={postId} />
      <input type="hidden" name="company_id" value={companyId} />
      <input type="hidden" name="version" value={post?.version ?? ""} />
      <fieldset disabled={pending} className="social-editor-grid">
        <div>
          {post?.asset_path ? (
            <SocialPhoto
              src={`/admin/redes/${post.id}/foto`}
              alt={post.alt_text || "Foto salva para este post"}
            />
          ) : (
            <PhotoInput onPrepared={preparePhoto} />
          )}
          {!post && (
            <label className="social-check">
              <input type="checkbox" name="image_rights" value="yes" required />
              Tenho autorização para usar esta foto e as imagens de pessoas
              nela.
            </label>
          )}
        </div>
        <div className="social-form-fields">
          <label>
            Título interno
            <input
              name="title"
              defaultValue={post?.title}
              minLength={3}
              maxLength={100}
              required
              placeholder="Ex.: Novidade da semana"
            />
          </label>
          <label>
            Conta de destino
            <select name="account_id" defaultValue={post?.account_id ?? ""}>
              <option value="">
                Escolher depois · só rascunho/planejamento
              </option>
              {accounts
                .filter((a) => a.active)
                .map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.network === "instagram" ? "Instagram" : "Facebook"} ·{" "}
                    {a.label}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Legenda e hashtags
            <textarea
              name="caption"
              rows={7}
              defaultValue={post?.caption}
              maxLength={2200}
              placeholder="Escreva ou salve a foto e gere com IA no próximo passo."
            />
          </label>
          <label>
            Descrição acessível da imagem
            <textarea
              name="alt_text"
              rows={2}
              defaultValue={post?.alt_text}
              maxLength={1000}
            />
          </label>
          <div className="social-two">
            <label>
              Dia e horário
              <input
                type="datetime-local"
                name="scheduled_local"
                defaultValue={socialWallClock(
                  post?.scheduled_at ?? null,
                  post?.time_zone ?? "America/Sao_Paulo",
                )}
              />
            </label>
            <label>
              Fuso
              <select
                name="time_zone"
                defaultValue={post?.time_zone ?? "America/Sao_Paulo"}
              >
                {socialZones.map((zone) => (
                  <option key={zone} value={zone}>
                    {zone.replace("America/", "").replaceAll("_", " ")}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="social-note">
            Salvar mantém um rascunho. Revise a versão salva antes de autorizar
            o agendamento.
          </p>
          <SocialSubmit disabled={!post && !photo}>
            {post ? "Salvar e voltar ao rascunho" : "Salvar foto e rascunho"}
          </SocialSubmit>
        </div>
      </fieldset>
    </form>
  );
}
