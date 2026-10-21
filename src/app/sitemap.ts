import { site, siteMap } from "@/lib/seo";
export default function sitemap() {
  return site.indexable
    ? [
        ...siteMap(),
        {
          url: new URL("/diagnostico", site.url).href,
          changeFrequency: "monthly" as const,
          priority: 0.7,
        },
      ]
    : [];
}
