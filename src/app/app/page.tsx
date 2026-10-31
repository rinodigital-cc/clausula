import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant } from "@/lib/auth/web";
import { knowledgeOverview, listConversations } from "@/lib/domain/consult";
import { can } from "@/lib/authz/policy";
import { AskForm } from "@/app/app/AskForm";
import { Alert, ConfidenceBadge, EmptyState, formatDateTime } from "@/ui/components";
import { IconBook } from "@/ui/icons";
import { BRAND } from "@/ui/brand";

export const metadata: Metadata = { title: "Consulta" };

/** Títulos genéricos de cláusula que não rendem uma boa pergunta de exemplo. */
const GENERIC = /^(objeto|objetivo|disposi|defini|gloss|introdu|pre[aâ]mbulo|geral|gerais|informa[cç]|condi[cç][oõ]es gerais|[ií]ndice|sum[aá]rio)/i;

/** Perguntas de exemplo geradas dos TÍTULOS REAIS de cláusulas do acervo. */
function suggestionsFrom(titles: { title: string; clause_title: string | null; section_kind: string }[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of titles) {
    const c = (t.clause_title ?? "").trim().replace(/[.:;]+$/, "");
    if (!c || c.length > 48 || c.length < 4 || GENERIC.test(c) || seen.has(c.toLowerCase())) continue;
    seen.add(c.toLowerCase());
    const x = c.toLowerCase();
    if (t.section_kind === "exclusion") out.push(/exclu/.test(x) ? "Quais riscos ficam excluídos do seguro?" : `O que fica de fora em ${x}?`);
    else if (t.section_kind === "waiting_period") out.push(`Qual é a regra de ${x}?`);
    else out.push(`Como funciona a cobertura de ${x}?`);
    if (out.length >= 3) break;
  }
  return out;
}

export default async function ConsultarPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { user, session } = await requireTenant("specialist.query");
  const [overview, recent] = await Promise.all([knowledgeOverview(session), listConversations(session)]);
  const firstName = user.name.split(" ")[0];

  return (
    <main className="ask-hero">
      {sp.bemvindo ? (
        <Alert tone="success" title="Acesso criado.">Boas-vindas, {firstName}. Comece com uma pergunta cuja resposta você já conhece: é o jeito mais rápido de ver como a {BRAND.name} trabalha.</Alert>
      ) : null}
      <div className="stack rise" style={{ gap: "var(--s-4)" }}>
        <span className="ai-tag">Consulta com apoio de IA</span>
        <h1 className="display">Qual é a sua dúvida, {firstName}?</h1>
        <p className="lead">
          Pergunte sobre coberturas, exclusões, carências ou franquias. A IA procura nos documentos da corretora e mostra o trecho de onde veio cada resposta. Se não estiver lá, ela avisa.
        </p>
      </div>

      {overview.docs === 0 ? (
        <EmptyState
          title="Ainda não há documentos para consultar"
          why={
            can(session, "source.write")
              ? "A IA responde só com base nos documentos da corretora. Envie as condições gerais das seguradoras com que vocês trabalham para liberar as consultas."
              : "A IA responde só com base nos documentos da corretora, e nenhum está pronto ainda. Avise quem administra a corretora na plataforma."
          }
          action={can(session, "source.write") ? { href: "/admin/biblioteca", label: "Adicionar documento" } : undefined}
        />
      ) : (
        <div className="stack rise rise-2" style={{ gap: "var(--s-4)" }}>
          <AskForm insurers={overview.insurers} suggestions={suggestionsFrom(overview.titles)} autoFocus />
          <p className="row muted" style={{ fontSize: "var(--text-sm)", gap: 8, paddingLeft: 4 }}>
            <IconBook size={16} />
            {overview.docs} {overview.docs === 1 ? "documento" : "documentos"} de {overview.insurerCount}{" "}
            {overview.insurerCount === 1 ? "seguradora" : "seguradoras"} na base ·{" "}
            <Link href="/app/biblioteca">ver documentos</Link>
          </p>
        </div>
      )}

      {recent.length > 0 ? (
        <section className="stack rise rise-4" aria-labelledby="recentes" style={{ gap: "var(--s-3)" }}>
          <div className="row-between" style={{ paddingInline: 4 }}>
            <h2 id="recentes" style={{ fontSize: "var(--text-lg)" }}>Suas consultas recentes</h2>
            <Link href="/app/historico" style={{ fontSize: "var(--text-sm)", fontWeight: 600 }}>Ver histórico</Link>
          </div>
          <ul className="card recent-list">
            {recent.slice(0, 5).map((c) => (
              <li key={c.id}>
                <Link href={`/app/consulta/${c.id}`}>
                  <span className="t">{c.title}</span>
                  <span className="row" style={{ gap: 10 }}>
                    {c.lastConfidence ? <ConfidenceBadge confidence={c.lastConfidence as "strong"} /> : null}
                    <span className="meta">{formatDateTime(c.updatedAt)}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <p className="muted" style={{ fontSize: "var(--text-xs)", paddingInline: 4 }}>{BRAND.disclaimer}</p>
    </main>
  );
}
