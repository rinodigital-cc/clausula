import type { MetadataRoute } from "next";

export default function sitemap(): MetadataRoute.Sitemap {
  const site = process.env.PUBLIC_SITE_URL ?? "https://apoiaseguro.com.br";
  return ["/", "/contato", "/privacidade"].map((p) => ({ url: `${site}${p}`, changeFrequency: "monthly", priority: p === "/" ? 1 : 0.5 }));
}
