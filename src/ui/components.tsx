import Link from "next/link";
import { IconCheck, IconHalf, IconInfo, IconNotFound, IconWarn, IconX, IconClock } from "@/ui/icons";

export function ConfidenceBadge({ confidence, status }: { confidence: "strong" | "partial" | "not_found"; status?: string }) {
  if (confidence === "not_found") {
    return <span className="badge badge-neutral"><IconNotFound size={14} />Não encontrei nos documentos</span>;
  }
  if (status === "conflict") {
    return <span className="badge badge-warn"><IconWarn size={14} />Fontes divergentes</span>;
  }
  if (confidence === "partial") {
    return <span className="badge badge-warn"><IconHalf size={14} />Evidência parcial — confira</span>;
  }
  return <span className="badge badge-evidence"><IconCheck size={14} />Fonte encontrada</span>;
}

const DOC_STATUS: Record<string, { cls: string; label: string; icon: React.ReactNode }> = {
  queued: { cls: "badge-neutral", label: "Na fila", icon: <IconClock size={13} /> },
  processing: { cls: "badge-info", label: "Processando", icon: <span className="spinner" style={{ width: 11, height: 11 }} /> },
  ready: { cls: "badge-evidence", label: "Pronto", icon: <IconCheck size={13} /> },
  ready_with_warnings: { cls: "badge-warn", label: "Pronto com ressalvas", icon: <IconHalf size={13} /> },
  failed: { cls: "badge-danger", label: "Falhou", icon: <IconX size={13} /> },
  superseded: { cls: "badge-neutral", label: "Substituído", icon: <IconClock size={13} /> },
};

export function DocStatusBadge({ status, stage }: { status: string | null; stage?: string | null }) {
  const s = DOC_STATUS[status ?? ""] ?? DOC_STATUS.queued!;
  return (
    <span className={`badge ${s.cls}`} title={stage ?? undefined}>
      {s.icon}
      {status === "processing" && stage ? stage : s.label}
    </span>
  );
}

export function Alert({ tone = "info", title, children }: { tone?: "info" | "warn" | "danger" | "success"; title?: string; children: React.ReactNode }) {
  const icon = tone === "warn" ? <IconWarn /> : tone === "danger" ? <IconX /> : tone === "success" ? <IconCheck /> : <IconInfo />;
  return (
    <div className={`alert alert-${tone}`} role={tone === "danger" ? "alert" : "status"}>
      {icon}
      <div>
        {title ? <b>{title} </b> : null}
        {children}
      </div>
    </div>
  );
}

export function EmptyState({ title, why, action }: { title: string; why: string; action?: { href: string; label: string } }) {
  return (
    <div className="empty">
      <h2>{title}</h2>
      <p className="muted">{why}</p>
      {action ? (
        <div>
          <Link className="btn btn-primary" href={action.href}>{action.label}</Link>
        </div>
      ) : null}
    </div>
  );
}

export function PageHead({ title, lead, children }: { title: string; lead?: string; children?: React.ReactNode }) {
  return (
    <div className="page-head">
      <div className="stack-sm">
        <h1>{title}</h1>
        {lead ? <p>{lead}</p> : null}
      </div>
      {children ? <div className="row">{children}</div> : null}
    </div>
  );
}

export function formatDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d.length === 10 ? `${d}T12:00:00` : d) : d;
  return date.toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" });
}

export function formatDateTime(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" });
}

export function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((p) => p[0]!.toUpperCase()).join("");
}
