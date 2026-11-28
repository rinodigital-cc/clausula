import type { Metadata } from "next";
import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { requirePlatformAdmin } from "@/lib/auth/web";
import { CREATED_COOKIE, type CreatedPayload } from "@/lib/http/cookies";
import { Alert, PageHead } from "@/ui/components";
import { CopyButton } from "@/ui/client";

export const metadata: Metadata = { title: "Corretora criada · Plataforma" };
export const dynamic = "force-dynamic";

export default async function CreatedPage() {
  await requirePlatformAdmin();
  const raw = (await cookies()).get(CREATED_COOKIE)?.value;
  let data: CreatedPayload | null = null;
  try { data = raw ? JSON.parse(raw) as CreatedPayload : null; } catch { data = null; }
  if (!data) redirect("/plataforma");

  return (
    <div className="stack-lg">
      <PageHead title="Corretora criada" lead={`${data.name} começa em modo teste. O responsável define a própria senha pelo convite.`} />
      {data.accepted ? (
        <Alert tone="success" title="Convite enviado">
          O provedor aceitou o e-mail para <b>{data.email}</b>. A confirmação de entrega aparece no painel de corretoras em instantes.
        </Alert>
      ) : data.provider ? (
        <Alert tone="warn" title="Convite na fila de envio">
          O envio imediato não foi concluído. A plataforma tenta de novo automaticamente; acompanhe o estado no painel. Se precisar, copie o link abaixo e envie por outro canal.
        </Alert>
      ) : (
        <Alert tone="warn" title="E-mail não configurado neste ambiente">
          O convite foi gravado, mas este ambiente ainda não tem provedor de e-mail. Copie o link e envie ao responsável por um canal seguro.
        </Alert>
      )}
      <section className="card card-pad stack">
        <h2 style={{ margin: 0, fontSize: "var(--text-lg)" }}>Link de primeiro acesso</h2>
        <p className="muted" style={{ margin: 0 }}>Vale por 7 dias, funciona uma vez e só com o e-mail {data.email}. Não contém senha.</p>
        <code className="mono" style={{ wordBreak: "break-all", fontSize: "var(--text-xs)" }}>{data.link}</code>
        <div className="row">
          <CopyButton text={data.link} label="Copiar link" />
          <Link className="btn btn-primary" href="/plataforma">Ver corretoras</Link>
        </div>
      </section>
    </div>
  );
}
