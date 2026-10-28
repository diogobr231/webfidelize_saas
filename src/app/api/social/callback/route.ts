import { cookies } from "next/headers";
import { requireOperationsAdmin } from "@/lib/admin-operations";
import { readSocialState, sealSocialToken } from "@/lib/social/crypto";
import {
  exchangeSocialCode,
  metaConfig,
  readMetaPage,
} from "@/lib/social/meta";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const { db, user } = await requireOperationsAdmin();
  const jar = await cookies(),
    url = new URL(request.url),
    config = metaConfig(process.env);
  const state = readSocialState(
    url.searchParams.get("state") ?? "",
    jar.get("wf-social-oauth")?.value ?? "",
    user.id,
    process.env.SOCIAL_TOKEN_ENCRYPTION_KEY ?? "",
  );
  jar.delete("wf-social-oauth");
  let notice = "conexao-falhou";
  if (state && config && !url.searchParams.has("error")) {
    const code = url.searchParams.get("code");
    if (code && code.length <= 4000) {
      try {
        const token = await exchangeSocialCode(config, code),
          page = await readMetaPage(config, state.page, token);
        if (page.id !== state.page) throw new Error("SOCIAL_PAGE_MISMATCH");
        const external =
          state.network === "instagram"
            ? page.instagram_business_account?.id
            : page.id;
        if (!external) throw new Error("SOCIAL_PROFESSIONAL_ACCOUNT_REQUIRED");
        const encrypted = sealSocialToken(
          page.access_token,
          `${state.company}:${state.network}:${external}`,
          process.env.SOCIAL_TOKEN_ENCRYPTION_KEY ?? "",
        );
        const { error } = await db.rpc("social_connect", {
          p_company: state.company,
          p_network: state.network,
          p_external: external,
          p_label:
            state.network === "instagram"
              ? (page.instagram_business_account?.username ?? page.name)
              : page.name,
          p_token: encrypted,
        });
        if (!error) notice = "conectado";
      } catch {
        /* No codes, tokens or provider response in redirects/logs. */
      }
    }
  }
  // APP_URL only; never redirect to an untrusted Host/query destination.
  if (!config)
    return new Response("Configuração social indisponível.", {
      status: 503,
      headers: {
        "Cache-Control": "no-store",
        "Referrer-Policy": "no-referrer",
      },
    });
  const destination = new URL("/admin/redes", config.origin);
  destination.searchParams.set("aviso", notice);
  if (state) destination.searchParams.set("empresa", state.company);
  return new Response(null, {
    status: 303,
    headers: {
      Location: destination.href,
      "Cache-Control": "private, no-store",
      "Referrer-Policy": "no-referrer",
    },
  });
}
