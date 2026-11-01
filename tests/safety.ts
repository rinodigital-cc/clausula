/** As suítes SQL e P0 apagam dados. Só permitem banco local explicitamente descartável. */
export function assertDisposableDatabase(env: Record<string, string | undefined> = process.env): void {
  const url = new URL(env.DATABASE_URL_ADMIN ?? "postgres://invalid/invalid");
  if (
    env.ALLOW_TEST_DB_RESET !== "1" ||
    !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname) ||
    !url.pathname.endsWith("_test")
  ) {
    throw new Error("Testes destrutivos exigem banco local com nome terminado em _test e ALLOW_TEST_DB_RESET=1.");
  }
  for (const key of ["DATABASE_URL", "BOOTSTRAP_DATABASE_URL", "PLATFORM_DATABASE_URL", "WORKER_DATABASE_URL", "PUBLIC_DATABASE_URL"]) {
    if (!env[key]) continue;
    const runtime = new URL(env[key]);
    if (runtime.hostname !== url.hostname || runtime.port !== url.port || runtime.pathname !== url.pathname) {
      throw new Error(`${key} deve apontar para o mesmo banco local descartável de DATABASE_URL_ADMIN.`);
    }
  }
}
