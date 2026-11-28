import { test, expect } from "@playwright/test";

test("produção: health, páginas públicas e login", async ({ page, request }) => {
  const health = await request.get("/api/saude");
  expect(health.status()).toBe(200);
  await expect.poll(async () => {
    const json = await health.json();
    return json;
  }).toMatchObject({ ok: true, db: "ok" });

  for (const route of ["/", "/contato", "/privacidade", "/entrar"]) {
    const response = await page.goto(route, { waitUntil: "domcontentloaded" });
    expect(response?.status()).toBe(200);
    await expect(page.locator("body")).toBeVisible();
  }

  await page.goto("/entrar");
  await expect(page.getByLabel("E-mail", { exact: true })).toBeVisible();
  await expect(page.getByLabel("Senha", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Entrar", exact: true })).toBeVisible();
});

test("produção: rotas protegidas exigem autenticação", async ({ page }) => {
  for (const route of ["/admin", "/plataforma"]) {
    await page.goto(route);
    await expect(page).toHaveURL(/\/entrar/);
  }
});

test("produção: headers essenciais de segurança", async ({ request }) => {
  const response = await request.get("/");
  expect(response.status()).toBe(200);
  const headers = response.headers();
  expect(headers["strict-transport-security"]).toBeTruthy();
  expect(headers["x-content-type-options"]).toBe("nosniff");
  expect(headers["x-frame-options"]).toBeTruthy();
  expect(headers["content-security-policy"]).toBeTruthy();
});
