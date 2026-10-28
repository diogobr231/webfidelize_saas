"use server";

import { randomUUID } from "node:crypto";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireCompany } from "@/lib/auth";
import {
  LOGO_BUCKET,
  LOGO_MAX_BYTES,
  COVER_BUCKET,
  COVER_MAX_BYTES,
  coverPathBelongsToCompany,
  validateCoverBytes,
  logoPathBelongsToCompany,
  personalizationSchema,
  validateLogoBytes,
  type PersonalizationState,
} from "@/lib/company-personalization";

async function owner(companyId: string) {
  if (!z.uuid().safeParse(companyId).success)
    redirect("/painel?erro=validacao");
  const context = await requireCompany(companyId, true);
  if (context.role !== "OWNER") redirect(`/painel/${companyId}?erro=permissao`);
  return context;
}

function refresh(companyId: string, slug: string | null) {
  revalidatePath(`/painel/${companyId}`, "layout");
  if (slug) revalidatePath(`/agendar/${slug}`);
}

export async function savePersonalization(
  companyId: string,
  _previous: PersonalizationState,
  form: FormData,
): Promise<PersonalizationState> {
  const { db, company } = await owner(companyId);
  const values = Object.fromEntries(
    [
      "name",
      "description",
      "address",
      "maps_url",
      "phone",
      "theme",
      "density",
      "agenda_view",
    ].map((field) => [
      field,
      typeof form.get(field) === "string" ? String(form.get(field)) : "",
    ]),
  );
  const parsed = personalizationSchema.safeParse(Object.fromEntries(form));
  if (!parsed.success)
    return {
      error: "Revise os campos indicados antes de salvar.",
      fields: Object.fromEntries(
        parsed.error.issues.map((issue) => [
          String(issue.path[0]),
          issue.message,
        ]),
      ),
      values,
    };
  const { error } = await db.rpc("configure_company_personalization", {
    c: companyId,
    ...parsed.data,
  });
  if (error)
    return {
      error:
        "Não foi possível salvar. Seus dados continuam no formulário; tente novamente.",
      values,
    };
  refresh(companyId, company.booking_slug);
  return {
    success:
      "Personalização salva. As preferências já estão disponíveis para sua equipe.",
  };
}

export async function saveCompanyLogo(
  companyId: string,
  _previous: PersonalizationState,
  form: FormData,
): Promise<PersonalizationState> {
  const { db, company } = await owner(companyId);
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  if (!secret)
    return {
      error:
        "O envio de logotipo está temporariamente indisponível. As outras configurações continuam disponíveis.",
    };
  const file = form.get("logo");
  const remove = form.get("remove_logo") === "on";
  const published = form.get("logo_published") === "on";
  let uploadedPath: string | null = null;
  let path: string | null = company.logo_path || null;
  if (remove && file instanceof File && file.size)
    return {
      error: "Escolha entre remover o logotipo ou enviar uma nova imagem.",
    };
  if (remove) path = null;
  else if (file instanceof File && file.size) {
    if (file.size > LOGO_MAX_BYTES)
      return { error: "Escolha uma imagem de até 750 KB." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateLogoBytes(bytes, file.type);
    if ("error" in checked) return { error: checked.error };
    path = `${companyId}/${randomUUID()}.${checked.extension}`;
    const result = await db.storage.from(LOGO_BUCKET).upload(path, bytes, {
      contentType: checked.mime,
      cacheControl: "60",
      upsert: false,
    });
    if (result.error)
      return {
        error:
          "Não conseguimos enviar a imagem. Confira o formato e tente novamente.",
      };
    uploadedPath = path;
  }
  if (!path && published && !remove)
    return {
      error: "Envie um logotipo antes de publicar na página de agendamento.",
    };
  const { data, error } = await db.rpc("configure_company_logo", {
    c: companyId,
    path,
    published: Boolean(path && published),
    gateway_secret: secret,
    expected_path: company.logo_path || null,
  });
  if (error) {
    // RLS refuses deletion of the current logo, including concurrent successful saves.
    if (uploadedPath) await db.storage.from(LOGO_BUCKET).remove([uploadedPath]);
    return {
      error: error.message.includes("logo version conflict")
        ? "O logotipo foi alterado em outra aba. Atualize a página antes de tentar novamente."
        : "Não foi possível salvar o logotipo. O logotipo atual foi preservado; tente novamente.",
    };
  }
  const previous = typeof data === "string" ? data : null;
  if (
    previous &&
    previous !== path &&
    logoPathBelongsToCompany(previous, companyId)
  ) {
    await db.storage.from(LOGO_BUCKET).remove([previous]);
  }
  // Retry cleanup after interrupted uploads without touching current or recent uploads.
  const { data: files } = await db.storage
    .from(LOGO_BUCKET)
    .list(companyId, { limit: 100 });
  const stale = (files || [])
    .filter(
      (entry) =>
        entry.created_at &&
        Date.parse(entry.created_at) < Date.now() - 24 * 60 * 60 * 1000,
    )
    .map((entry) => `${companyId}/${entry.name}`)
    .filter(
      (entry) => entry !== path && logoPathBelongsToCompany(entry, companyId),
    );
  if (stale.length) await db.storage.from(LOGO_BUCKET).remove(stale);
  refresh(companyId, company.booking_slug);
  return {
    success: remove
      ? "Logotipo removido."
      : "Logotipo salvo. A publicação segue a preferência escolhida.",
  };
}
export async function saveCompanyCover(
  companyId: string,
  _previous: PersonalizationState,
  form: FormData,
): Promise<PersonalizationState> {
  const { db, company } = await owner(companyId);
  const secret = process.env.BOOKING_GATEWAY_SECRET;
  if (!secret)
    return {
      error:
        "O envio da foto de capa está temporariamente indisponível. As outras configurações continuam disponíveis.",
    };
  const file = form.get("cover");
  const remove = form.get("remove_cover") === "on";
  const published = form.get("cover_published") === "on";
  let uploadedPath: string | null = null;
  let path: string | null = company.cover_path || null;
  if (remove && file instanceof File && file.size)
    return {
      error: "Escolha entre remover a foto de capa ou enviar uma nova imagem.",
    };
  if (remove) path = null;
  else if (file instanceof File && file.size) {
    if (file.size > COVER_MAX_BYTES)
      return { error: "Escolha uma imagem de até 750 KB." };
    const bytes = new Uint8Array(await file.arrayBuffer());
    const checked = validateCoverBytes(bytes, file.type);
    if ("error" in checked) return { error: checked.error };
    path = `${companyId}/${randomUUID()}.${checked.extension}`;
    const result = await db.storage.from(COVER_BUCKET).upload(path, bytes, {
      contentType: checked.mime,
      cacheControl: "60",
      upsert: false,
    });
    if (result.error)
      return {
        error:
          "Não conseguimos enviar a imagem. Confira o formato e tente novamente.",
      };
    uploadedPath = path;
  }
  if (!path && published && !remove)
    return {
      error:
        "Envie uma foto de capa antes de publicar na página de agendamento.",
    };
  const { data, error } = await db.rpc("configure_company_cover", {
    c: companyId,
    path,
    published: Boolean(path && published),
    gateway_secret: secret,
    expected_path: company.cover_path || null,
  });
  if (error) {
    // RLS refuses deletion of the current cover, including concurrent successful saves.
    if (uploadedPath)
      await db.storage.from(COVER_BUCKET).remove([uploadedPath]);
    return {
      error: error.message.includes("cover version conflict")
        ? "A foto de capa foi alterada em outra aba. Atualize a página antes de tentar novamente."
        : "Não foi possível salvar a foto de capa. A foto atual foi preservada; tente novamente.",
    };
  }
  const previous = typeof data === "string" ? data : null;
  if (
    previous &&
    previous !== path &&
    coverPathBelongsToCompany(previous, companyId)
  ) {
    await db.storage.from(COVER_BUCKET).remove([previous]);
  }
  // Retry cleanup after interrupted uploads without touching current or recent uploads.
  const { data: files } = await db.storage
    .from(COVER_BUCKET)
    .list(companyId, { limit: 100 });
  const stale = (files || [])
    .filter(
      (entry) =>
        entry.created_at &&
        Date.parse(entry.created_at) < Date.now() - 24 * 60 * 60 * 1000,
    )
    .map((entry) => `${companyId}/${entry.name}`)
    .filter(
      (entry) => entry !== path && coverPathBelongsToCompany(entry, companyId),
    );
  if (stale.length) await db.storage.from(COVER_BUCKET).remove(stale);
  refresh(companyId, company.booking_slug);
  return {
    success: remove
      ? "Foto de capa removida."
      : "Foto de capa salva. A publicação segue a preferência escolhida.",
  };
}
