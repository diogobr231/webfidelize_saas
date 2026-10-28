import { niches } from "@/lib/catalog";
import { site, siteMap } from "@/lib/seo";
export default function sitemap() {
  return site.indexable
    ? [
        ...siteMap(),
        {
          url: new URL("/servicos", site.url).href,
          changeFrequency: "monthly" as const,
          priority: 0.8,
        },
        {
          url: new URL("/planos", site.url).href,
          changeFrequency: "monthly" as const,
          priority: 0.8,
        },
        ...niches.map((n) => ({
          url: new URL(`/segmentos/${n.slug}`, site.url).href,
          changeFrequency: "monthly" as const,
          priority: 0.8,
        })),
        {
          url: new URL("/diagnostico", site.url).href,
          changeFrequency: "monthly" as const,
          priority: 0.7,
        },
      ]
    : [];
}
