import type { Metadata } from "next";
import Link from "next/link";
import { requireTenant, getMemberships } from "@/lib/auth/web";
import { adminOverview } from "@/lib/domain/gaps";
import { listCatalog } from "@/lib/domain/catalog";
import { listConversations } from "@/lib/domain/consult";
import { Alert, PageHead } from "@/ui/components";
import { FlashMessage } from "@/ui/flash";
import { IconCheck } from "@/ui/icons";

export const metadata: Metadata = { title: "Administração" };

type Step = { done: boolean; title: string; why: string; href: string; cta: string };

export default async function AdminHome({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const sp = await searchParams;
  const { user, session } = await requireTenant("analytics.read");
  const [o, catalog, mine, memberships] = await Promise.all([
    adminOverview(session),
    listCatalog(session),
    listConversations(session),
    getMemberships(user.userId),
  ]);
  const org = memberships.find((m) => m.orgId === session.orgId);
  const trial = org?.orgStatus === "trial";

  // Implantação: a ordem é a do caminho mínimo até o primeiro corretor consultar.
  const steps: Step[] = [
    {
      done: catalog.length > 0,
      title: "Cadastre as seguradoras com que a corretora trabalha",
      why: "Elas organizam os documentos e permitem filtrar a consulta por seguradora.",
      href: "/admin/catalogo",
      cta: "Abrir catálogo",
    },
    {
      done: o.ready + o.processing + o.failed > 0,
      title: "Envie as condições gerais em PDF",
      why: "As respostas usam só o que estiver aqui. Comece pelos produtos que mais geram dúvida.",
      href: "/admin/biblioteca",
      cta: "Adicionar documento",
    },
    {
      done: o.ready > 0,
      title: "Espere o processamento e confira o resultado",
      why: "Cada documento é lido página por página. Arquivos escaneados sem texto são recusados com explicação.",
      href: "/admin/biblioteca",
      cta: "Ver situação",
    },
    {
      done: mine.length > 0,
      title: "Faça uma pergunta que você já sabe responder",
      why: "É o teste mais rápido: confira se a resposta e o trecho citado batem com o que você conhece.",
      href: "/app",
      cta: "Testar consulta",
    },
    {
      done: o.members + o.invites > 1,
      title: "Convide o primeiro corretor",
      why: "Ele recebe um link de primeiro acesso, cria a senha e já entra na tela de consulta.",
      href: "/admin/equipe",
      cta: "Convidar",
    },
  ];
  const doneCount = steps.filter((s) => s.done).length;
  const next = steps.find((s) => !s.done);

  return (
    <div className="stack-lg">
      <FlashMessage />
      {sp.bemvindo ? (
        <Alert tone="success" title="Acesso criado.">Bem-vindo à {org?.orgName}. Siga os passos abaixo para deixar a corretora pronta para os corretores.</Alert>
      ) : null}
      <PageHead title="Administração" lead="Como está a preparação da corretora, o que pede atenção e qual é o próximo passo.">
        {trial ? <span className="badge badge-info" title="A corretora está em período de teste">Modo teste</span> : null}
      </PageHead>

      {doneCount < steps.length ? (
        <section className="card stack" aria-labelledby="implantacao" style={{ padding: "var(--s-6)" }}>
          <div className="row-between">
            <h2 id="implantacao" style={{ fontSize: "var(--text-lg)" }}>Preparação da corretora</h2>
            <span className="meta">{doneCount} de {steps.length} concluídos</span>
          </div>
          <div className="progress" role="progressbar" aria-valuemin={0} aria-valuemax={steps.length} aria-valuenow={doneCount} aria-label="Progresso da preparação">
            <span style={{ width: `${(doneCount / steps.length) * 100}%` }} />
          </div>
          <ol className="checklist">
            {steps.map((s, i) => (
              <li key={i} className={s.done ? "done" : s === next ? "next" : ""}>
                <span className="mark" aria-hidden="true">{s.done ? <IconCheck size={14} /> : i + 1}</span>
                <div className="stack-sm" style={{ gap: 2, flex: 1, minWidth: 0 }}>
                  <b>{s.title}{s.done ? <span className="sr-only"> (concluído)</span> : null}</b>
                  {!s.done ? <span className="muted" style={{ fontSize: "var(--text-sm)" }}>{s.why}</span> : null}
                </div>
                {s === next ? <Link className="btn btn-primary btn-sm" href={s.href}>{s.cta}</Link> : null}
              </li>
            ))}
          </ol>
        </section>
      ) : null}

      {o.failed > 0 || o.expired > 0 ? (
        <div className="stack-sm">
          {o.failed > 0 ? (
            <Alert tone="danger" title={`${o.failed} ${o.failed === 1 ? "documento falhou" : "documentos falharam"} no processamento.`}>
              <Link href="/admin/biblioteca?status=failed">Ver o motivo e reenviar</Link>
            </Alert>
          ) : null}
          {o.expired > 0 ? (
            <Alert tone="warn" title={`${o.expired} ${o.expired === 1 ? "documento está" : "documentos estão"} com vigência encerrada.`}>
              As respostas avisam o corretor, mas vale substituir pela versão nova. <Link href="/admin/biblioteca?status=expired">Ver quais</Link>
            </Alert>
          ) : null}
        </div>
      ) : null}

      <section aria-label="Números" className="grid-stats">
        <Link className="stat" href="/admin/biblioteca"><span className="v">{o.ready}</span><span className="k">documentos prontos</span></Link>
        <Link className="stat" href="/admin/biblioteca"><span className="v">{o.processing}</span><span className="k">em processamento</span></Link>
        <Link className="stat" href="/admin/equipe"><span className="v">{o.members}</span><span className="k">pessoas com acesso{o.invites ? ` · ${o.invites} convite(s)` : ""}</span></Link>
        <div className="stat"><span className="v">{o.consults7}</span><span className="k">consultas em 7 dias</span></div>
        <Link className="stat" href="/admin/lacunas"><span className="v">{o.gaps}</span><span className="k">perguntas sem resposta{o.notFound7 ? ` · ${o.notFound7} sem resposta em 7 dias` : ""}</span></Link>
        <Link className="stat" href="/admin/qualidade"><span className="v">{o.negative}</span><span className="k">avaliações negativas em 30 dias</span></Link>
      </section>
    </div>
  );
}
