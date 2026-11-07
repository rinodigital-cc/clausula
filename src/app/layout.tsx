import type { Metadata, Viewport } from "next";
import "@fontsource-variable/newsreader";
import "@fontsource-variable/jetbrains-mono";
import "@/styles/globals.css";
import { BRAND } from "@/ui/brand";

// URL canônica PLANEJADA. Não significa que o domínio esteja publicado.
const SITE = process.env.PUBLIC_SITE_URL ?? "https://apoiaseguro.com.br";

const TITLE = `${BRAND.name} — ${BRAND.descriptor}`;
const DESCRIPTION =
  "Consulte condições gerais, coberturas, exclusões e carências com apoio de IA. Cada resposta mostra o trecho e o documento de onde veio. A decisão continua com o corretor.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: TITLE, template: `%s · ${BRAND.name}` },
  description: DESCRIPTION,
  applicationName: BRAND.name,
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }, { url: "/favicon.ico", sizes: "16x16 32x32 48x48" }],
    apple: "/apple-touch-icon.png",
  },
  manifest: "/site.webmanifest",
  appleWebApp: { title: BRAND.name, capable: true, statusBarStyle: "default" },
  openGraph: {
    type: "website",
    locale: "pt_BR",
    siteName: BRAND.name,
    title: `${BRAND.name} — Respostas técnicas sobre seguros, com a fonte à vista`,
    description: BRAND.promise,
    images: [{ url: "/og.png", width: 1200, height: 630, alt: `${BRAND.name}: ${BRAND.promise}` }],
  },
  twitter: {
    card: "summary_large_image",
    title: `${BRAND.name} — Respostas técnicas sobre seguros, com a fonte à vista`,
    description: BRAND.promise,
    images: ["/og.png"],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#12305C",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <head>
        <link rel="preload" href="/fonts/InterVariable.woff2" as="font" type="font/woff2" crossOrigin="anonymous" />
      </head>
      <body>
        <a className="skip-link" href="#conteudo">Pular para o conteúdo</a>
        {children}
      </body>
    </html>
  );
}
