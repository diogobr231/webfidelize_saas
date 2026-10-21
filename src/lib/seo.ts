import type { Metadata, MetadataRoute } from "next";

export function resolveSite(raw?: string, deployment?: string) {
  let url = new URL("http://localhost:3000");
  try {
    const candidate = new URL(raw || "");
    if (
      ["https:", "http:"].includes(candidate.protocol) &&
      !candidate.username &&
      !candidate.password
    )
      url = new URL(candidate.origin);
  } catch {
    /* An unset deployment URL must not publish a guessed domain. */
  }
  const local =
    url.hostname === "localhost" ||
    url.hostname.endsWith(".localhost") ||
    url.hostname === "[::1]" ||
    /^127\./.test(url.hostname) ||
    /^10\./.test(url.hostname) ||
    /^192\.168\./.test(url.hostname) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(url.hostname) ||
    url.hostname.endsWith(".invalid") ||
    !url.hostname.includes(".");
  return {
    url,
    indexable:
      url.protocol === "https:" &&
      !local &&
      deployment !== "preview" &&
      deployment !== "development",
  };
}

export const site = resolveSite(process.env.APP_URL, process.env.VERCEL_ENV);
export const siteTitle = "Web Fidelize | Agenda online e gestão de clientes";
export const siteDescription =
  "Organize clientes, serviços e profissionais em uma agenda visual. Receba reservas pela sua página de agendamento. Teste a Web Fidelize grátis por 7 dias.";

export const landingMetadata: Metadata = {
  title: siteTitle,
  description: siteDescription,
  alternates: { canonical: site.url.href },
  robots: { index: site.indexable, follow: site.indexable },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: "Web Fidelize",
    title: siteTitle,
    description: siteDescription,
    url: site.url.href,
  },
  twitter: {
    card: "summary_large_image",
    title: siteTitle,
    description: siteDescription,
  },
};

export const landingStructuredData = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "WebSite",
      "@id": `${site.url.href}#website`,
      name: "Web Fidelize",
      url: site.url.href,
      inLanguage: "pt-BR",
      publisher: { "@id": `${site.url.href}#organization` },
    },
    {
      "@type": "Organization",
      "@id": `${site.url.href}#organization`,
      name: "Web Fidelize",
      url: site.url.href,
      contactPoint: {
        "@type": "ContactPoint",
        telephone: "+55-18-99769-5445",
        contactType: "sales",
        availableLanguage: "Portuguese",
        url: "https://wa.me/5518997695445",
      },
    },
  ],
};

export function siteRobots(config = site): MetadataRoute.Robots {
  if (!config.indexable) return { rules: { userAgent: "*", disallow: "/" } };
  return {
    rules: {
      userAgent: "*",
      allow: "/",
      disallow: [
        "/admin",
        "/painel",
        "/auth/",
        "/entrar",
        "/cadastro",
        "/comecar",
        "/recuperar",
        "/nova-senha",
        "/convite/",
        "/confirmar/",
        "/api/whatsapp/",
        "/agendar/",
      ],
    },
    sitemap: new URL("/sitemap.xml", config.url).href,
  };
}

export function siteMap(config = site): MetadataRoute.Sitemap {
  return config.indexable
    ? [{ url: config.url.href, changeFrequency: "monthly", priority: 1 }]
    : [];
}
