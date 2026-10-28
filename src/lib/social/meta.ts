import { z } from "zod";

export type MetaConfig = {
  version: string;
  appId: string;
  appSecret: string;
  origin: string;
};
export function metaConfig(
  env: Record<string, string | undefined>,
): MetaConfig | null {
  try {
    const {
      META_APP_ID: appId,
      META_APP_SECRET: appSecret,
      META_GRAPH_VERSION: version,
      APP_URL,
    } = env;
    if (
      !appId ||
      !/^\d{5,30}$/.test(appId) ||
      !appSecret ||
      !version ||
      !/^v\d{2}\.0$/.test(version) ||
      !APP_URL
    )
      return null;
    const url = new URL(APP_URL);
    if (
      url.protocol !== "https:" ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.pathname !== "/"
    )
      return null;
    return { appId, appSecret, version, origin: url.origin };
  } catch {
    return null;
  }
}
export function metaLoginUrl(config: MetaConfig, state: string): string {
  const url = new URL(
    `https://www.facebook.com/${config.version}/dialog/oauth`,
  );
  url.search = new URLSearchParams({
    client_id: config.appId,
    redirect_uri: `${config.origin}/api/social/callback`,
    state,
    response_type: "code",
    scope:
      "pages_show_list,pages_read_engagement,pages_manage_posts,instagram_basic,instagram_content_publish",
  }).toString();
  return url.href;
}
/** Fixed provider host, bounded response, no external error messages or tokens in logs. */
export async function metaRequest(
  config: Pick<MetaConfig, "version">,
  path: string,
  params: Record<string, string>,
  token?: string,
  method: "GET" | "POST" = "GET",
  transport: typeof fetch = fetch,
): Promise<unknown> {
  if (
    !/^v\d{2}\.0$/.test(config.version) ||
    !/^(?:oauth\/access_token|\d{5,30}(?:\/(?:media|media_publish|photos))?)$/.test(
      path,
    )
  )
    throw new Error("META_INVALID_REQUEST");
  const url = new URL(`https://graph.facebook.com/${config.version}/${path}`);
  const form = new URLSearchParams(params);
  if (method === "GET") url.search = form.toString();
  const response = await transport(url, {
    method,
    redirect: "error",
    cache: "no-store",
    signal: AbortSignal.timeout(12000),
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(method === "POST"
        ? { "Content-Type": "application/x-www-form-urlencoded" }
        : {}),
    },
    ...(method === "POST" ? { body: form } : {}),
  });
  if (!response.ok) throw new Error("META_REJECTED");
  const text = await response.text();
  if (text.length > 50000) throw new Error("META_INVALID_RESPONSE");
  return JSON.parse(text);
}
const access = z.object({ access_token: z.string().min(20).max(10000) });
export async function exchangeSocialCode(config: MetaConfig, code: string) {
  const short = access.parse(
    await metaRequest(config, "oauth/access_token", {
      client_id: config.appId,
      client_secret: config.appSecret,
      redirect_uri: `${config.origin}/api/social/callback`,
      code,
    }),
  );
  return access.parse(
    await metaRequest(config, "oauth/access_token", {
      grant_type: "fb_exchange_token",
      client_id: config.appId,
      client_secret: config.appSecret,
      fb_exchange_token: short.access_token,
    }),
  ).access_token;
}
export async function readMetaPage(
  config: MetaConfig,
  pageId: string,
  token: string,
) {
  return z
    .object({
      id: z.string().regex(/^\d{5,30}$/),
      name: z.string().min(1).max(200),
      access_token: z.string().min(20).max(10000),
      instagram_business_account: z
        .object({
          id: z.string().regex(/^\d{5,30}$/),
          username: z.string().max(200).optional(),
        })
        .optional(),
    })
    .parse(
      await metaRequest(
        config,
        pageId,
        {
          fields:
            "id,name,access_token,instagram_business_account{id,username}",
        },
        token,
      ),
    );
}
const identifier = z.object({ id: z.string().regex(/^[\d_]{5,80}$/) });
export async function publishSocialPhoto(
  input: {
    version: string;
    network: "instagram" | "facebook";
    externalId: string;
    token: string;
    imageUrl: string;
    caption: string;
    altText: string;
  },
  transport: typeof fetch = fetch,
): Promise<string> {
  const config = { version: input.version };
  if (input.network === "facebook") {
    const output = await metaRequest(
      config,
      `${input.externalId}/photos`,
      {
        url: input.imageUrl,
        caption: input.caption,
        alt_text_custom: input.altText,
        published: "true",
      },
      input.token,
      "POST",
      transport,
    );
    return identifier.parse(output).id;
  }
  const media = identifier.parse(
    await metaRequest(
      config,
      `${input.externalId}/media`,
      {
        image_url: input.imageUrl,
        caption: input.caption,
        alt_text: input.altText,
      },
      input.token,
      "POST",
      transport,
    ),
  );
  // Do not loop/retry publication: a timeout can mean that the provider did publish.
  const ready = z
    .object({ status_code: z.string() })
    .parse(
      await metaRequest(
        config,
        media.id,
        { fields: "status_code" },
        input.token,
        "GET",
        transport,
      ),
    );
  if (ready.status_code !== "FINISHED") throw new Error("META_NOT_READY");
  return identifier.parse(
    await metaRequest(
      config,
      `${input.externalId}/media_publish`,
      { creation_id: media.id },
      input.token,
      "POST",
      transport,
    ),
  ).id;
}
