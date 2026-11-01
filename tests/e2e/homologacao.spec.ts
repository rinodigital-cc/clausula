import { test, expect, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import AxeBuilder from "@axe-core/playwright";

async function login(page: Page, email = "ana@aurora.test") {
  await page.goto("/entrar");
  await page.getByLabel("E-mail", { exact: true }).fill(email);
  await page.getByLabel("Senha", { exact: true }).fill("senha-simulacao-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page).toHaveURL(email.startsWith("operacao") ? /\/plataforma$/ : /\/app$/);
}

test("saúde, páginas públicas e acesso anônimo", async ({ page, request }) => {
  const health = await request.get("/api/saude");
  expect(health.status()).toBe(200);
  expect(await health.json()).toMatchObject({ ok: true, db: "ok" });
  for (const route of ["/", "/contato", "/privacidade"]) {
    const response = await page.goto(route);
    expect(response?.status()).toBe(200);
    await expect(page.locator("h1")).toBeVisible();
  }
  await page.goto("/plataforma");
  await expect(page).toHaveURL(/\/entrar/);
});

test("login rejeita senha errada e aceita a conta local", async ({ page }) => {
  await page.goto("/entrar");
  await page.getByLabel("E-mail", { exact: true }).fill("ana@aurora.test");
  await page.getByLabel("Senha", { exact: true }).fill("senha-incorreta-123");
  await page.getByRole("button", { name: "Entrar", exact: true }).click();
  await expect(page.locator("#login-erro")).toContainText("E-mail ou senha incorretos");
  await login(page);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Ana");
});

test("consulta com fonte, grifo e PDF autorizado", async ({ page }) => {
  await login(page);
  await page.getByLabel("Sua pergunta").fill("Quais são as exclusões da cobertura de danos elétricos no residencial da Aurora?");
  await page.getByRole("button", { name: "Perguntar", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/consulta\//);
  await expect(page.getByRole("link", { name: /^Fonte 1:/ })).toBeVisible();
  await page.getByRole("link", { name: /^Fonte 1:/ }).click();
  await expect(page.locator("#trecho")).toBeVisible();
  const { docA } = JSON.parse(readFileSync("test-results/e2e-fixture.json", "utf8"));
  const pdf = await page.request.get(`/api/documentos/${docA.versionId}/arquivo`);
  expect(pdf.status()).toBe(200);
  expect(pdf.headers()["content-type"]).toBe("application/pdf");
  expect((await pdf.body()).subarray(0, 5).toString()).toBe("%PDF-");
});

test("pergunta sem evidência não inventa resposta", async ({ page }) => {
  await login(page);
  await page.getByLabel("Sua pergunta").fill("Qual o prazo de portabilidade da previdência privada?");
  await page.getByRole("button", { name: "Perguntar", exact: true }).click();
  await expect(page).toHaveURL(/\/app\/consulta\//);
  await expect(page.locator(".answer")).toContainText("Não encontrei");
  await expect(page.getByRole("link", { name: /^Fonte \d+:/ })).toHaveCount(0);
});

test("corretora B não acessa PDF ou biblioteca da A", async ({ page }) => {
  await login(page, "bia@cardeal.test");
  const { docA } = JSON.parse(readFileSync("test-results/e2e-fixture.json", "utf8"));
  const response = await page.request.get(`/api/documentos/${docA.versionId}/arquivo`);
  expect(response.status()).toBe(404);
  await page.goto("/app/biblioteca");
  await expect(page.getByRole("link", { name: /Vida Cardeal/ })).toBeVisible();
  await expect(page.getByText("Residencial Aurora (SIMULAÇÃO)", { exact: true })).toHaveCount(0);
});

test("administrador de corretora não acessa a plataforma", async ({ page }) => {
  await login(page);
  for (const route of ["/plataforma", "/plataforma/nova", "/plataforma/interessados"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/sem-permissao$/);
  }
});

test("operador cria corretora, reemite convite, suspende e reativa", async ({ page, browser }) => {
  await login(page, "operacao@apoia.test");
  await page.getByRole("link", { name: "Nova corretora", exact: true }).click();
  await page.getByLabel("Nome da corretora").fill("Corretora E2E (SIMULAÇÃO)");
  await page.getByLabel("E-mail do responsável").fill("dono@e2e.test");
  await page.getByRole("button", { name: "Criar corretora", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("criada em modo teste");
  const original = await page.locator("code").innerText();
  await page.goto("/plataforma");
  const row = page.getByRole("row").filter({ hasText: "Corretora E2E (SIMULAÇÃO)" });
  await row.getByText("Reenviar convite", { exact: true }).click();
  await row.getByRole("button", { name: "Gerar novo convite" }).click();
  await expect(row.getByRole("status")).toContainText("anterior deixou de valer");
  const renewed = await row.locator("code").innerText();
  expect(renewed).not.toBe(original);
  const guest = await browser.newContext();
  const guestPage = await guest.newPage();
  await guestPage.goto(original);
  await expect(guestPage.getByRole("button", { name: "Criar acesso e entrar" })).toHaveCount(0);
  await guestPage.goto(renewed);
  await guestPage.getByLabel("Seu nome completo").fill("Dono (SIMULAÇÃO)");
  await guestPage.getByLabel("Crie uma senha", { exact: true }).fill("senha-simulacao-123");
  await guestPage.getByLabel("Confirme a senha").fill("senha-simulacao-123");
  await guestPage.getByRole("button", { name: "Criar acesso e entrar" }).click();
  await expect(guestPage).toHaveURL(/\/app\?bemvindo=1$/);
  await row.getByRole("button", { name: "Suspender", exact: true }).click();
  await expect(row.getByText("Suspensa", { exact: true })).toBeVisible();
  await guestPage.goto("http://localhost:3000/app");
  await expect(guestPage).toHaveURL(/\/sem-acesso$/);
  await row.getByRole("button", { name: "Reativar", exact: true }).click();
  await expect(row.getByText("Ativa", { exact: true })).toBeVisible();
  await guestPage.goto("http://localhost:3000/app");
  await expect(guestPage).toHaveURL(/\/app$/);
  await guest.close();
});

test("contato do site aparece no painel e pode ser qualificado", async ({ page }) => {
  await page.goto("/contato");
  await page.getByLabel("Seu nome", { exact: true }).fill("Interessada (SIMULAÇÃO)");
  await page.getByLabel("E-mail profissional").fill("interessada@e2e.test");
  await page.getByRole("checkbox").check();
  // O formulário exige pelo menos 2,5 segundos de preenchimento humano.
  await page.waitForTimeout(2600);
  await page.getByRole("button", { name: "Enviar", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("Recebemos seu contato");
  await login(page, "operacao@apoia.test");
  await page.getByRole("link", { name: "Interessados", exact: true }).click();
  const row = page.getByRole("row").filter({ hasText: "interessada@e2e.test" });
  await row.getByRole("combobox").selectOption("qualified");
  await row.getByRole("button", { name: "Salvar situação" }).click();
  await expect(row.getByRole("combobox")).toHaveValue("qualified");
});

test("PDF enviado pela administração é processado pelo worker", async ({ page }) => {
  await login(page);
  await page.goto("/admin/biblioteca?enviar=1");
  await page.getByLabel("Arquivo PDF").setInputFiles("tests/fixtures/pdfs/atlantica-residencial-v2.pdf");
  await page.getByLabel("Título", { exact: true }).fill("Upload E2E (SIMULAÇÃO)");
  await page.getByRole("checkbox").check();
  await page.getByRole("button", { name: "Enviar documento", exact: true }).click();
  await expect(page).toHaveURL(/\/admin\/biblioteca\//);
  execFileSync(process.execPath, ["--import", "tsx", "services/worker/index.ts", "--once"], { env: process.env, stdio: "pipe" });
  await page.reload();
  await expect(page.locator(".page-head")).toContainText("Pronto");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Upload E2E (SIMULAÇÃO)");
});

test("acessibilidade das telas públicas, consulta e plataforma", async ({ page }) => {
  const scan = async () => {
    await page.evaluate(async () => {
      await document.fonts.ready;
      await Promise.all(document.getAnimations()
        .filter(animation => animation.effect instanceof KeyframeEffect
          && animation.effect.target instanceof Element
          && animation.effect.target.checkVisibility()
          && animation.effect.getComputedTiming().iterations !== Infinity)
        .map(animation => animation.finished.catch(() => {})));
    });
    const results = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"]).analyze();
    expect(results.violations).toEqual([]);
  };
  for (const route of ["/", "/contato", "/entrar"]) { await page.goto(route); await scan(); }
  await login(page);
  await scan();
  await page.goto("/plataforma");
  await page.context().clearCookies();
  await login(page, "operacao@apoia.test");
  for (const route of ["/plataforma", "/plataforma/nova", "/plataforma/interessados"]) { await page.goto(route); await scan(); }
});
