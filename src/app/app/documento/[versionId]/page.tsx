import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/web";
import { getPage } from "@/lib/domain/documents";
import { reflow, splitHighlight } from "@/lib/highlight";
import { Alert, formatDate } from "@/ui/components";
import { IconArrowLeft, IconArrowRight, IconExternal } from "@/ui/icons";

export const metadata: Metadata = { title: "Documento" };

export default async function DocumentoPage({
  params,
  searchParams,
}: {
  params: Promise<{ versionId: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { versionId } = await params;
  const sp = await searchParams;
  const { session } = await requireTenant("library.browse");
  const page = await getPage(session, versionId, Number(sp.p ?? 1));
  if (!page) notFound();
  const q = (sp.q ?? "").slice(0, 300);
  const text = reflow(page.content ?? "");
  const parts = q ? splitHighlight(text, q) : null;
  const href = (p: number) => `/app/documento/${versionId}?p=${p}${q ? `&q=${encodeURIComponent(q)}` : ""}`;
  const today = new Date().toISOString().slice(0, 10);

  return (
    <main className="container" style={{ paddingTop: "var(--s-6)", paddingBottom: "var(--s-16)", maxWidth: 920 }}>
      <div className="stack">
        <Link href="/app/biblioteca" className="back-link">
          <IconArrowLeft size={16} /> Documentos
        </Link>
        <div className="stack-sm">
          <h1 style={{ fontSize: "var(--text-2xl)" }}>{page.title}</h1>
          <p className="meta">
            {[page.insurerName, page.productName, `versão ${page.versionNumber}`, page.validUntil ? `vigência até ${formatDate(page.validUntil)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </p>
        </div>
        {!page.isCurrent ? <Alert tone="warn" title="Versão anterior.">Esta versão já foi substituída por uma mais recente.</Alert> : null}
        {page.validUntil && page.validUntil < today ? (
          <Alert tone="warn" title="Vigência encerrada.">Confirme se a seguradora publicou uma versão mais recente.</Alert>
        ) : null}
        {q && !parts && page.content ? (
          <Alert tone="info" title="Trecho não localizado nesta página.">O texto citado pode continuar na página seguinte.</Alert>
        ) : null}

        <section className="doc-panel" style={{ maxHeight: "none" }} aria-label={`Página ${page.page}`}>
          <header className="row-between">
            <span className="meta">Página {page.page} de {page.pageCount}</span>
            {page.hasFile ? (
              <a href={`/api/documentos/${versionId}/arquivo#page=${page.page}`} target="_blank" rel="noopener" className="row" style={{ fontSize: "var(--text-sm)" }}>
                Abrir PDF original <IconExternal size={14} />
              </a>
            ) : null}
          </header>
          <div className="doc-text">
            {page.content ? (
              parts ? (
                <>
                  {parts[0]}
                  <mark id="trecho">{parts[1]}</mark>
                  {parts[2]}
                </>
              ) : (
                page.content
              )
            ) : (
              <span className="muted">Esta página não tem texto extraído (pode ser imagem ou estar em branco).</span>
            )}
          </div>
        </section>

        <nav className="row-between" aria-label="Páginas">
          {page.page > 1 ? (
            <Link className="btn btn-secondary btn-sm" href={href(page.page - 1)}><IconArrowLeft size={16} /> Página anterior</Link>
          ) : <span />}
          {page.page < page.pageCount ? (
            <Link className="btn btn-secondary btn-sm" href={href(page.page + 1)}>Próxima página <IconArrowRight size={16} /></Link>
          ) : <span />}
        </nav>
      </div>
    </main>
  );
}
