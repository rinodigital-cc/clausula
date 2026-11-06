import "server-only";
import { withTenant } from "@/lib/db/client";
import type { Session } from "@/lib/auth/session";
import { authorize } from "@/lib/authz/policy";
import { recordAudit } from "@/lib/audit";

export const LINES: Record<string, string> = {
  residencial: "Residencial",
  automovel: "Automóvel",
  vida: "Vida",
  empresarial: "Empresarial",
  condominio: "Condomínio",
  saude: "Saúde",
  previdencia: "Previdência",
  viagem: "Viagem",
  outros: "Outros",
};

export type Insurer = { id: string; name: string; products: { id: string; name: string; line: string }[] };

export async function listCatalog(session: Session): Promise<Insurer[]> {
  return withTenant(session, async (tx) => {
    const insurers = await tx<{ id: string; name: string }[]>`SELECT id, name FROM insurers ORDER BY lower(name)`;
    const products = await tx<{ id: string; name: string; line: string; insurer_id: string }[]>`
      SELECT id, name, line, insurer_id FROM products ORDER BY lower(name)
    `;
    return insurers.map((i) => ({
      ...i,
      products: products.filter((p) => p.insurer_id === i.id).map(({ id, name, line }) => ({ id, name, line })),
    }));
  });
}

export async function createInsurer(session: Session, nameRaw: string): Promise<void> {
  authorize(session, "catalog.manage");
  const name = nameRaw.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Informe o nome da seguradora.");
  await withTenant(session, async (tx) => {
    try {
      const [row] = await tx<{ id: string }[]>`INSERT INTO insurers (org_id, name) VALUES ((SELECT current_org()), ${name}) RETURNING id`;
      await recordAudit(tx, { actorId: session.userId, action: "catalog.insurer_created", entityType: "insurer", entityId: row!.id });
    } catch (e) {
      if ((e as { code?: string }).code === "23505") throw new Error("Essa seguradora já está cadastrada.");
      throw e;
    }
  });
}

export async function createProduct(session: Session, input: { insurerId: string; name: string; line: string }): Promise<void> {
  authorize(session, "catalog.manage");
  const name = input.name.trim();
  if (name.length < 2 || name.length > 120) throw new Error("Informe o nome do produto.");
  if (!LINES[input.line]) throw new Error("Ramo inválido.");
  await withTenant(session, async (tx) => {
    try {
      const [row] = await tx<{ id: string }[]>`
        INSERT INTO products (org_id, insurer_id, name, line)
        VALUES ((SELECT current_org()), ${input.insurerId}, ${name}, ${input.line}) RETURNING id
      `;
      await recordAudit(tx, { actorId: session.userId, action: "catalog.product_created", entityType: "product", entityId: row!.id });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if (code === "23505") throw new Error("Esse produto já existe para a seguradora.");
      if (code === "23503") throw new Error("Seguradora não encontrada.");
      throw e;
    }
  });
}
