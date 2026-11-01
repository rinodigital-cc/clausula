import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { notFound } from "next/navigation";
import { requireTenant } from "@/lib/auth/web";
import { getConversation, knowledgeOverview, type Citation, type MessageView } from "@/lib/domain/consult";
import { getPage } from "@/lib/domain/documents";
import { reflow, splitHighlight } from "@/lib/highlight";
import { feedbackAction } from "@/app/actions/consult";
import { AskForm } from "@/app/app/AskForm";
import { Claims, Warnings, citationHref, citationLabel, shortLabel, warningText } from "@/ui/answer";
import { EvidenceThread } from "./EvidenceThread";
import { Alert, formatDate, formatDateTime } from "@/ui/components";
import { BRAND } from "@/ui/brand";
import { IconArrowLeft, IconArrowRight, IconCheck, IconDoc, IconExternal, IconHalf, IconNotFound, IconWarn } from "@/ui/icons";

export const metadata: Metadata = { title: "Consulta" };

/** Trilha do raciocínio: o que a IA fez antes de responder, em passos. */
function Trail({ m }: { m: MessageView }) {
  const docs = new Set(m.citations.map((c) => c.sourceTitle)).size;
  const restrictions = m.claims.filter((c) => c.kind === "restriction").length;
  const risky = m.warnings.filter((w) => warningText(w).tone === "warn").length;
  const caveats = restrictions + risky;
  if (m.confidence === "not_found") {
    return (
      <ol className="trail" aria-label="O que a IA fez">
        <li><span className="ic ok" aria-hidden="true"><IconCheck size={12} /></span>Procurou nos documentos da corretora</li>
        <li><span className="ic no" aria-hidden="true"><IconNotFound size={12} /></span>Nenhum trecho sobre isso</li>
      </ol>
    );
  }
  return (
    <ol className="trail" aria-label="O que a IA fez">
      <li><span className="ic ok" aria-hidden="true"><IconCheck size={12} /></span>Consultou <b>{docs}</b> {docs === 1 ? "documento" : "documentos"}</li>
      <li><span className="ic ok" aria-hidden="true"><IconCheck size={12} /></span><b>{m.citations.length}</b> {m.citations.length === 1 ? "trecho encontrado" : "trechos encontrados"}</li>
      {m.confidence === "partial" || m.status === "conflict" ? (
        <li><span className="ic wr" aria-hidden="true"><IconHalf size={12} /></span>{m.status === "conflict" ? "Fontes divergentes" : "Evidência parcial"}</li>
      ) : null}
      {caveats ? (
        <li><span className="ic wr" aria-hidden="true"><IconWarn size={12} /></span><b>{caveats}</b> {caveats === 1 ? "ressalva" : "ressalvas"}</li>
      ) : null}
    </ol>
  );
}

function SourceList({ m, conversationId, selected }: { m: MessageView; conversationId: string; selected: string | null }) {
  if (!m.citations.length) return null;
  return (
    <div className="sources">
      <h3 className="sources-title">Fontes · o que está escrito</h3>
      <div className="source-pills">
        {m.citations.map((c) => {
          const key = `${m.id}-${c.ordinal}`;
          return (
            <Link key={key} className="source" href={citationHref(conversationId, m, c)} aria-current={selected === key ? "true" : undefined} scroll={false}
              aria-label={`Fonte ${c.ordinal}: ${c.sourceTitle}${citationLabel(c) ? `, ${citationLabel(c)}` : ""}`}>
              <span className="n" aria-hidden="true">{c.ordinal}</span>
              <span className="s">
                <b>{c.sourceTitle}</b>
                <span className="meta">{[c.insurerName, shortLabel(c)].filter(Boolean).join(" · ")}</span>
              </span>
            </Link>
          );
        })}
      </div>
      {/* No celular o painel lateral some: o trecho literal aparece aqui mesmo */}
      <div className="inline-evidence" aria-label="Trechos citados">
        {m.citations.map((c) => (
          <figure key={c.ordinal}>
            <figcaption>
              <span>Trecho {c.ordinal} · {c.sourceTitle}</span>
              <span className="meta">{shortLabel(c)}</span>
            </figcaption>
            <blockquote className="quote"><mark>{c.quote}</mark></blockquote>
            {c.sourceVersionId ? (
              <Link href={`/app/documento/${c.sourceVersionId}?p=${c.pageNumber ?? 1}&q=${encodeURIComponent(c.quote.slice(0, 160))}`} className="row" style={{ fontSize: "var(--text-sm)", fontWeight: 600, gap: 6 }}>
                <IconDoc size={16} /> Ver no documento
              </Link>
            ) : null}
          </figure>
        ))}
      </div>
    </div>
  );
}

function Feedback({ m, conversationId, thanked }: { m: MessageView; conversationId: string; thanked: boolean }) {
  if (thanked || m.myFeedback) {
    return <p className="muted feedback-row" style={{ fontSize: "var(--text-sm)" }} role="status">Obrigado. Sua avaliação ajuda a corretora a melhorar a base de consulta.</p>;
  }
  return (
    <form action={feedbackAction} className="stack-sm" aria-label="Avaliar resposta">
      <input type="hidden" name="mensagem" value={m.id} />
      <input type="hidden" name="conversa" value={conversationId} />
      <div className="feedback-row">
        <span className="muted" style={{ fontSize: "var(--text-sm)", marginRight: 6 }}>Esta resposta ajudou?</span>
        <button className="btn btn-sm" name="avaliacao" value="useful">Ajudou</button>
        <button className="btn btn-sm" name="avaliacao" value="incomplete">Incompleta</button>
        <button className="btn btn-sm" name="avaliacao" value="wrong">Errada</button>
      </div>
      <details>
        <summary className="muted" style={{ fontSize: "var(--text-sm)", cursor: "pointer" }}>Adicionar comentário (opcional)</summary>
        <label htmlFor={`com-${m.id}`} className="sr-only">Comentário</label>
        <textarea id={`com-${m.id}`} name="comentario" rows={2} maxLength={2000} className="textarea" style={{ marginTop: 8 }} placeholder="Conte o que faltou ou o que está errado. Isso vai para quem administra a corretora." />
      </details>
    </form>
  );
}

function Turn({ m, index, conversationId, selected, activeOrdinal, thanked }: { m: MessageView; index: number; conversationId: string; selected: string | null; activeOrdinal: number | null; thanked: boolean }) {
  const insurers = [...new Set(m.citations.map((c) => c.insurerName).filter(Boolean))] as string[];
  const Q = index === 0 ? "h1" : "h2";
  return (
    <section className="turn" id={`m-${m.id}`} aria-labelledby={`q-${m.id}`}>
      <div className="stack-sm rise">
        <div className="q-meta">
          {insurers.slice(0, 3).map((i) => <span key={i} className="chip">{i}</span>)}
          <span>{formatDateTime(m.createdAt)}</span>
        </div>
        <Q className="q-title" id={`q-${m.id}`}>{m.question}</Q>
      </div>
      <Trail m={m} />

      <article className="answer" aria-label="Resposta">
        {m.confidence === "not_found" ? (
          <>
            <span className="ai-pill muted">Não encontrei nos documentos</span>
            <p className="summary">{m.summary || "Não encontrei esta informação nos documentos da corretora."}</p>
            <p className="not-found-why">
              Preferimos avisar a arriscar uma resposta sem fonte. A pergunta foi enviada para quem administra a corretora completar a base. Enquanto isso, confirme com a seguradora.
            </p>
            {m.suggestedRephrase ? <p className="muted">Tente perguntar assim: <i>{m.suggestedRephrase}</i></p> : null}
            {/* “Modo literal” não diz nada quando não há trecho nenhum */}
            <Warnings warnings={m.warnings.filter((w) => w.kind !== "modo_extrativo")} />
          </>
        ) : (
          <>
            <span className="ai-pill">
              {m.mode === "generative"
                ? `Resposta da IA, com base em ${m.citations.length} ${m.citations.length === 1 ? "trecho" : "trechos"}`
                : "Frases retiradas dos documentos, sem redação da IA"}
            </span>
            <p className={m.mode === "generative" ? "summary" : "summary literal"}>{m.summary}</p>
            <Warnings warnings={m.warnings} />
            <Claims m={m} conversationId={conversationId} activeOrdinal={activeOrdinal} />
            <SourceList m={m} conversationId={conversationId} selected={selected} />
          </>
        )}
        <Feedback m={m} conversationId={conversationId} thanked={thanked} />
      </article>
    </section>
  );
}

async function DocPanel({ session, citation, all, conversationId, msg }: { session: Parameters<typeof getPage>[0]; citation: Citation | null; all: Citation[]; conversationId: string; msg: MessageView | null }) {
  const head = (
    <div className="src-head">
      <span className="src-label">Fonte · o que está escrito</span>
      {msg && all.length > 1 ? (
        <nav className="pager" aria-label="Trechos desta resposta">
          {all.map((c) => (
            <Link key={c.ordinal} href={citationHref(conversationId, msg, c)} scroll={false} aria-current={citation?.ordinal === c.ordinal ? "true" : undefined} aria-label={`Trecho ${c.ordinal}`}>
              {c.ordinal}
            </Link>
          ))}
        </nav>
      ) : null}
    </div>
  );
  if (!citation || !citation.sourceVersionId) {
    return (
      <div className="doc-panel">
        <header>{head}</header>
        <div className="doc-text" style={{ fontFamily: "var(--font-sans)", whiteSpace: "normal", marginBottom: 14, fontSize: "var(--text-sm)" }}>
          <p className="muted">Quando a resposta tiver fontes, o trecho aparece aqui, grifado dentro do documento original.</p>
        </div>
      </div>
    );
  }
  const page = await getPage(session, citation.sourceVersionId, citation.pageNumber ?? 1);
  if (!page) {
    return (
      <div className="doc-panel">
        <header>{head}<div className="doc-meta"><b>{citation.sourceTitle}</b></div></header>
        <div className="doc-text" style={{ fontFamily: "var(--font-sans)", whiteSpace: "normal", marginBottom: 14 }}>
          <Alert tone="info" title="Documento indisponível.">
            Este documento foi retirado da base depois da consulta. O trecho citado continua registrado:
          </Alert>
          <blockquote className="quote" style={{ marginTop: 12 }}>{citation.quote}</blockquote>
        </div>
      </div>
    );
  }
  const text = reflow(page.content ?? "");
  const parts = splitHighlight(text, citation.quote);
  const outdated = !page.isCurrent;
  return (
    <section className="doc-panel" aria-label="Documento de origem">
      <header>
        {head}
        <div className="doc-meta">
          <b>{page.title}</b>
          <span className="meta">
            {[page.insurerName, citationLabel(citation) || `p. ${page.page}`, `versão ${page.versionNumber}`, page.validUntil ? `vigência até ${formatDate(page.validUntil)}` : null]
              .filter(Boolean)
              .join(" · ")}
          </span>
        </div>
        {outdated ? <Alert tone="warn" title="Versão anterior.">Este trecho é de uma versão que já foi substituída por uma mais recente.</Alert> : null}
      </header>
      <div className="doc-text" tabIndex={0} aria-label={`Página ${page.page} de ${page.pageCount}, com o trecho citado grifado`}>
        {page.content ? (
          parts ? (
            <>
              {parts[0]}
              <mark id="trecho">{parts[1]}</mark>
              {parts[2]}
            </>
          ) : (
            <>
              <blockquote className="quote" style={{ whiteSpace: "normal", marginBottom: 16 }}>{citation.quote}</blockquote>
              {text}
            </>
          )
        ) : (
          <span className="muted">Esta página não tem texto legível (pode ser imagem).</span>
        )}
      </div>
      <footer>
        <span className="meta">Página {page.page} de {page.pageCount}</span>
        <span className="row" style={{ gap: 16 }}>
          <Link href={`/app/documento/${page.versionId}?p=${page.page}&q=${encodeURIComponent(citation.quote.slice(0, 160))}`}>Abrir documento <IconArrowRight size={14} /></Link>
          {page.hasFile ? (
            <a href={`/api/documentos/${page.versionId}/arquivo#page=${page.page}`} target="_blank" rel="noopener">
              PDF original <IconExternal size={14} />
            </a>
          ) : null}
        </span>
      </footer>
    </section>
  );
}

export default async function ConsultaPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const { session } = await requireTenant("conversation.read.own");
  const data = await getConversation(session, id);
  if (!data) notFound();
  const { conversation, messages, isOwner } = data;
  const overview = isOwner ? await knowledgeOverview(session) : null;

  // Fonte selecionada: ?fonte=<mensagem>-<n>; senão, a 1ª fonte da mensagem em foco (ou da última)
  const focusMsg = messages.find((m) => m.id === sp.m) ?? messages[messages.length - 1];
  let selected: Citation | null = null;
  let selectedKey: string | null = null;
  if (sp.fonte) {
    const dash = sp.fonte.lastIndexOf("-");
    const mid = sp.fonte.slice(0, dash);
    const ord = Number(sp.fonte.slice(dash + 1));
    const msg = messages.find((m) => m.id === mid);
    selected = msg?.citations.find((c) => c.ordinal === ord) ?? null;
    if (selected) selectedKey = sp.fonte;
  }
  if (!selected && focusMsg && focusMsg.citations[0]) {
    selected = focusMsg.citations[0];
    selectedKey = `${focusMsg.id}-${selected.ordinal}`;
  }

  const selectedMsg = selected ? messages.find((m) => m.citations.includes(selected!)) ?? null : null;

  return (
    <main className="consult">
      <div className="consult-main">
        <div className="consult-top">
          <Link href="/app/historico" className="back-link">
            <IconArrowLeft size={16} /> Histórico
          </Link>
          <Link href="/app" className="btn btn-secondary btn-sm">Nova consulta</Link>
        </div>
        {!isOwner ? (
          <Alert tone="info" title="Consulta de outra pessoa.">
            Feita por {conversation.authorName}. Você vê porque administra a corretora; só quem perguntou pode avaliar ou continuar.
          </Alert>
        ) : null}
        {messages.map((m, i) => (
          <Turn
            key={m.id}
            m={m}
            index={i}
            conversationId={conversation.id}
            selected={selectedKey}
            activeOrdinal={selectedMsg?.id === m.id ? selected?.ordinal ?? null : null}
            thanked={sp.obrigado === m.id || !isOwner}
          />
        ))}
        <p className="muted" style={{ fontSize: "var(--text-xs)" }}>{BRAND.disclaimer}</p>
        {isOwner && overview ? (
          <section className="composer-dock" aria-label="Continuar consulta">
            <h2 className="sr-only">Continuar nesta consulta</h2>
            <AskForm conversationId={conversation.id} insurers={overview.insurers} placeholder="Pergunte mais um detalhe sobre o mesmo assunto" compact />
          </section>
        ) : null}
      </div>
      <aside className="consult-side" aria-label="Trecho de origem">
        <DocPanel session={session} citation={selected} all={selectedMsg?.citations ?? []} conversationId={conversation.id} msg={selectedMsg} />
      </aside>
      <Suspense fallback={null}><EvidenceThread /></Suspense>
    </main>
  );
}
