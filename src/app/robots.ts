import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const site = process.env.PUBLIC_SITE_URL ?? "https://apoiaseguro.com.br";
  return {
    rules: [{ userAgent: "*", allow: ["/", "/contato", "/privacidade"], disallow: ["/app", "/admin", "/plataforma", "/api", "/convite", "/redefinir"] }],
    sitemap: `${site}/sitemap.xml`,
  };
}
