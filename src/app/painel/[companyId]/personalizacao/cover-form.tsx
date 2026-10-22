"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { Icon } from "@/components/ui/icon";
import {
  COVER_SOURCE_MAX_BYTES,
  type PersonalizationState,
} from "@/lib/company-personalization";
import { prepareCompanyCover } from "@/lib/prepare-company-cover";

export function CoverForm({
  saveAction,
  permalink,
  cover,
  hasCover,
  published,
  enabled,
  companyName,
}: {
  saveAction: (
    state: PersonalizationState,
    form: FormData,
  ) => Promise<PersonalizationState>;
  permalink: string;
  cover: string | null;
  hasCover: boolean;
  published: boolean;
  enabled: boolean;
  companyName: string;
}) {
  const [prepared, setPrepared] = useState<File | null>(null);
  const [preparing, setPreparing] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const [failedPreview, setFailedPreview] = useState<string | null>(null);
  const [fileError, setFileError] = useState("");
  const selection = useRef(0);
  const fileInput = useRef<HTMLInputElement>(null);
  const [state, action, pending] = useActionState(saveAction, {}, permalink);
  useEffect(() => {
    if (state.success) {
      setPrepared(null);
      if (fileInput.current) fileInput.current.value = "";
    }
  }, [state]);
  useEffect(() => {
    if (!prepared) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(prepared);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [prepared]);
  const image = preview || cover;

  return (
    <form
      action={action}
      className="personalization-logo-form"
      aria-busy={preparing || pending}
      // React also resets after a resolved action containing validation errors.
      // Keep the actual FileList and publication choice paired with their preview;
      // clear only the file after the backend explicitly confirms success.
      onReset={(event) => event.preventDefault()}
      onSubmit={(event) => {
        if (preparing || fileError) {
          event.preventDefault();
          return;
        }
        if (
          new FormData(event.currentTarget).get("remove_cover") === "on" &&
          !window.confirm(
            "Remover a foto de capa? Sua página continuará funcionando com a identidade da empresa.",
          )
        )
          event.preventDefault();
      }}
    >
      <div className="personalization-cover-preview">
        {image && image !== failedPreview ? (
          <img
            src={image}
            alt={`Foto do espaço de ${companyName}`}
            width={960}
            height={540}
            onError={() => setFailedPreview(image)}
          />
        ) : (
          <div>
            <Icon name="building" size={32} />
            <strong>Seu espaço, sua identidade</strong>
            <span>Mostre o ambiente que seus clientes vão encontrar.</span>
          </div>
        )}
      </div>
      {hasCover && ((!cover && !preview) || image === failedPreview) ? (
        <p className="muted">
          A foto salva foi preservada, mas não carregou agora. Atualize a página
          para tentar novamente.
        </p>
      ) : null}
      <div>
        <label htmlFor="cover">Foto do espaço</label>
        <input
          id="cover"
          name="cover"
          ref={fileInput}
          type="file"
          accept="image/png,image/jpeg,image/webp"
          aria-describedby="cover-tip"
          disabled={pending}
          onChange={async (event) => {
            const attempt = ++selection.current;
            const input = event.currentTarget;
            const file = input.files?.[0];
            setPrepared(null);
            setFileError("");
            setPreparing(false);
            if (!file) return;
            if (file.size > COVER_SOURCE_MAX_BYTES) {
              setFileError("Escolha uma foto de até 10 MB.");
              return;
            }
            setPreparing(true);
            try {
              const ready = await prepareCompanyCover(file);
              if (attempt === selection.current) {
                if (typeof DataTransfer !== "function")
                  throw new Error(
                    "Atualize seu navegador para enviar a foto otimizada.",
                  );
                const selectionFiles = new DataTransfer();
                selectionFiles.items.add(ready);
                input.files = selectionFiles.files;
                setPrepared(ready);
              }
            } catch (error) {
              if (attempt === selection.current)
                setFileError(
                  error instanceof Error
                    ? error.message
                    : "Não conseguimos preparar a foto. Tente outra imagem.",
                );
            } finally {
              if (attempt === selection.current) setPreparing(false);
            }
          }}
        />
        <small id="cover-tip">
          PNG, JPEG ou WebP de até 10 MB. A foto é reduzida no seu aparelho para
          carregar rápido. Prefira uma imagem horizontal do seu espaço; o centro
          aparece na capa.
        </small>
        <noscript>
          <p className="muted">
            Sem JavaScript, envie uma foto já reduzida para até 750 KB e 2560
            pixels.
          </p>
        </noscript>
      </div>
      <div aria-live="polite" aria-atomic="true">
        {preparing ? (
          <p className="muted" role="status">
            Preparando sua foto…
          </p>
        ) : prepared ? (
          <p className="muted" role="status">
            Prévia pronta. Salve para aplicar a foto.
          </p>
        ) : null}
        {fileError || state.error ? (
          <p className="notice error" role="alert">
            {fileError || state.error}
          </p>
        ) : null}
        {state.success ? (
          <p className="notice personalization-success" role="status">
            {state.success}
          </p>
        ) : null}
      </div>
      <label className="personalization-check">
        <input
          type="checkbox"
          name="cover_published"
          defaultChecked={published}
        />
        <span>
          Exibir foto na página de agendamento
          <small>
            Use uma foto que sua empresa tenha autorização para publicar. Ela só
            aparece enquanto o agendamento estiver ativo.
          </small>
        </span>
      </label>
      {!enabled ? (
        <p className="muted">
          Sua página pública está desabilitada. A foto será exibida quando você
          habilitar o agendamento.
        </p>
      ) : null}
      {hasCover ? (
        <label className="personalization-check">
          <input type="checkbox" name="remove_cover" />
          <span>
            Remover a foto atual
            <small>A remoção será aplicada ao salvar.</small>
          </span>
        </label>
      ) : null}
      <button
        disabled={pending || preparing || Boolean(fileError)}
        aria-busy={pending}
      >
        {pending ? "Salvando foto…" : "Salvar foto do espaço"}
      </button>
    </form>
  );
}
