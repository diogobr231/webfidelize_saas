"use server";
import { z } from "zod";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import {
  adPlanSchema,
  postFields,
  socialInstant,
  socialMoney,
  socialNetworks,
  socialPostSchema,
  socialZones,
  validSocialJpeg,
} from "@/lib/social/core";
import { makeSocialState } from "@/lib/social/crypto";
import { metaConfig, metaLoginUrl } from "@/lib/social/meta";
import { socialCaption, socialConfiguration } from "@/lib/social/server";

export type SocialState = { error?: string; success?: string };
const base = "/admin/redes";
const fail = (): SocialState => ({
  error:
    "Não foi possível confirmar. Confira os campos, atualize a página e tente novamente. Alterações em outra aba precisam ser recarregadas.",
});
const identity = z.object({
  id: z.uuid(),
  company_id: z.uuid(),
  version: z.preprocess(
    (v) => (v === "" || v === null ? null : Number(v)),
    z.number().int().positive().nullable(),
  ),
});

export async function saveSocialPost(
  _previous: SocialState,
  form: FormData,
): Promise<SocialState> {
  const { db } = await requireOperationsAdmin();
  const input = identity.safeParse(Object.fromEntries(form));
  const fields = z
    .object({
      title: z.string().trim().min(3).max(100),
      caption: z.string().trim().max(2200),
      alt_text: z.string().trim().max(1000),
      account_id: z.union([z.uuid(), z.literal("")]),
      time_zone: z.enum(socialZones),
      scheduled_local: z.string().max(16),
    })
    .safeParse(Object.fromEntries(form));
  if (!input.success || !fields.success)
    return { error: "Confira título, legenda, conta e horário." };
  const time = fields.data.scheduled_local
    ? socialInstant(fields.data.scheduled_local, fields.data.time_zone)
    : null;
  if (fields.data.scheduled_local && !time)
    return { error: "Data ou horário inválido no fuso selecionado." };
  let path: string | null = null;
  if (!input.data.version) {
    const file = form.get("photo");
    if (
      !(file instanceof File) ||
      !file.size ||
      file.size > 1500000 ||
      file.type !== "image/jpeg" ||
      !validSocialJpeg(new Uint8Array(await file.arrayBuffer()))
    )
      return {
        error:
          "Anexe uma foto JPEG de até 1,5 MB. O editor converte PNG e fotos maiores antes de enviar.",
      };
    if (form.get("image_rights") !== "yes")
      return { error: "Confirme que tem autorização para usar esta imagem." };
    path = `${input.data.company_id}/${input.data.id}.jpg`;
    const upload = await db.storage
      .from("social-assets")
      .upload(path, file, { contentType: "image/jpeg", upsert: false });
    if (upload.error) {
      // An acknowledgement can be lost after Storage committed. Reuse only identical bytes.
      const existing = await db.storage.from("social-assets").download(path);
      if (
        existing.error ||
        !existing.data ||
        existing.data.size !== file.size ||
        createHash("sha256")
          .update(new Uint8Array(await existing.data.arrayBuffer()))
          .digest("hex") !==
          createHash("sha256")
            .update(new Uint8Array(await file.arrayBuffer()))
            .digest("hex")
      )
        return {
          error:
            "A foto não foi confirmada. Reabra o rascunho pela lista ou anexe outra foto em um novo post.",
        };
    }
  }
  const { scheduled_local: _local, ...payload } = fields.data;
  void _local;
  const result = await db.rpc("social_save_post", {
    p_id: input.data.id,
    p_company: input.data.company_id,
    p_version: input.data.version,
    p_payload: {
      ...payload,
      account_id: payload.account_id || null,
      asset_path: path,
      scheduled_at: time,
    },
  });
  if (result.error || !socialPostSchema.safeParse(result.data).success)
    return fail();
  revalidatePath(base);
  redirect(
    `${base}?empresa=${input.data.company_id}&post=${input.data.id}&aviso=salvo#editor`,
  );
}
export async function transitionSocialPost(
  _previous: SocialState,
  form: FormData,
): Promise<SocialState> {
  const { db } = await requireOperationsAdmin();
  const data = z
    .object({
      id: z.uuid(),
      version: z.coerce.number().int().positive(),
      status: z.enum(["draft", "planned", "scheduled", "cancelled"]),
    })
    .safeParse(Object.fromEntries(form));
  if (!data.success) return fail();
  if (
    data.data.status === "scheduled" &&
    (!socialConfiguration().publishing ||
      !socialConfiguration().worker ||
      form.get("confirm_publish") !== "yes")
  )
    return {
      error:
        "Conecte a conta, configure o agendador e confirme a autorização para publicar automaticamente.",
    };
  const result = await db.rpc("social_transition", {
    p_id: data.data.id,
    p_version: data.data.version,
    p_status: data.data.status,
  });
  if (result.error)
    return {
      error:
        "Não foi possível mudar o estado. Confira conexão, foto, legenda e um horário entre 5 minutos e 366 dias no futuro. Atualize se outra aba editou o post.",
    };
  revalidatePath(base);
  return {
    success:
      data.data.status === "scheduled"
        ? "Publicação autorizada para o horário salvo."
        : "Estado atualizado. Nenhum envio foi executado por este botão.",
  };
}
export async function generateSocialCaption(
  _previous: SocialState,
  form: FormData,
): Promise<SocialState> {
  const { db } = await requireOperationsAdmin();
  const data = z
    .object({
      id: z.uuid(),
      version: z.coerce.number().int().positive(),
      brief: z.string().trim().min(10).max(1200),
      confirm_ai: z.literal("yes"),
    })
    .safeParse(Object.fromEntries(form));
  if (!data.success)
    return {
      error: "Descreva a foto e autorize o envio à IA e o consumo de créditos.",
    };
  if (!socialConfiguration().ai)
    return {
      error:
        "Configure o AI Gateway antes de gerar. Você pode escrever a legenda manualmente.",
    };
  const record = await db
    .from("platform_social_posts")
    .select(postFields)
    .eq("id", data.data.id)
    .single();
  const post = socialPostSchema.safeParse(record.data);
  if (record.error || !post.success || post.data.version !== data.data.version)
    return fail();
  const company = await db
    .from("companies")
    .select("name")
    .eq("id", post.data.company_id)
    .single();
  if (company.error || !company.data) return fail();
  const image = post.data.asset_path
    ? await db.storage.from("social-assets").download(post.data.asset_path)
    : null;
  if (image?.error || (image?.data && image.data.size > 1500000)) return fail();
  const reservation = await db.rpc("social_begin_generation", {
    p_id: data.data.id,
    p_version: data.data.version,
  });
  if (reservation.error || !z.uuid().safeParse(reservation.data).success)
    return {
      error:
        "Geração bloqueada: versão alterada, tentativa pendente ou limite de 20/dia e 300/mês atingido.",
    };
  let caption: string | null = null;
  try {
    caption = await socialCaption(
      company.data.name,
      data.data.brief,
      image?.data ? new Uint8Array(await image.data.arrayBuffer()) : null,
    );
  } catch {
    /* Failed attempts remain reserved/countable, without leaking provider data. */
  }
  const finished = await db.rpc("social_finish_generation", {
    p_generation: reservation.data,
    p_caption: caption,
  });
  if (finished.error || finished.data !== "succeeded")
    return {
      error:
        "O texto atual foi preservado. A IA pode estar indisponível, sem créditos ou o rascunho pode ter mudado. Confira antes de tentar novamente.",
    };
  revalidatePath(base);
  redirect(
    `${base}?empresa=${post.data.company_id}&post=${post.data.id}&aviso=ia#editor`,
  );
}
export async function connectSocialAccount(
  _previous: SocialState,
  form: FormData,
): Promise<SocialState> {
  const { db, user } = await requireOperationsAdmin();
  const data = z
    .object({
      company_id: z.uuid(),
      page_id: z
        .string()
        .trim()
        .regex(/^\d{5,30}$/),
      network: z.enum(socialNetworks),
      confirm_account: z.literal("yes"),
    })
    .safeParse(Object.fromEntries(form));
  const config = metaConfig(process.env);
  if (!data.success)
    return {
      error:
        "Escolha a rede, informe o ID da página vinculada e confirme a empresa responsável.",
    };
  if (!config || !socialConfiguration().oauth)
    return {
      error:
        "Configure o aplicativo Meta, URL de retorno e chave de criptografia. A conta ainda não foi conectada.",
    };
  const company = await db
    .from("companies")
    .select("id")
    .eq("id", data.data.company_id)
    .single();
  if (company.error || !company.data) return fail();
  const state = makeSocialState(
    {
      company: data.data.company_id,
      user: user.id,
      network: data.data.network,
      page: data.data.page_id,
    },
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY ?? "",
  );
  (await cookies()).set("wf-social-oauth", state, {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 600,
  });
  redirect(metaLoginUrl(config, state));
}
export async function revokeSocialAccount(
  _previous: SocialState,
  form: FormData,
): Promise<SocialState> {
  const { db } = await requireOperationsAdmin();
  const id = z.uuid().safeParse(form.get("account_id"));
  if (!id.success || form.get("confirm_revoke") !== "yes")
    return {
      error:
        "Confirme a desconexão. Agendamentos desta conta voltarão a planejados.",
    };
  const { error } = await db.rpc("social_revoke", { p_account: id.data });
  if (error)
    return {
      error:
        "Desconexão não confirmada. Aguarde se houver uma publicação em andamento.",
    };
  revalidatePath(base);
  return { success: "Conta desconectada e autorizações de envio removidas." };
}
export async function saveAdPlan(
  _previous: SocialState,
  form: FormData,
): Promise<SocialState> {
  const { db } = await requireOperationsAdmin();
  const id = identity.safeParse(Object.fromEntries(form));
  const parsed = adPlanSchema.safeParse({
    ...Object.fromEntries(form),
    media_budget_cents: socialMoney(String(form.get("media_budget") ?? "")),
    management_fee_cents: socialMoney(String(form.get("management_fee") ?? "")),
  });
  if (!id.success || !parsed.success)
    return {
      error:
        "Confira conta de anúncios, período e valores. Use reais sem separador de milhar.",
    };
  const { error } = await db.rpc("social_save_ad", {
    p_id: id.data.id,
    p_company: id.data.company_id,
    p_version: id.data.version,
    p_payload: parsed.data,
  });
  if (error) return fail();
  revalidatePath(base);
  return {
    success:
      "Planejamento salvo. A verba não foi gasta e nenhuma campanha foi ativada na Meta.",
  };
}
