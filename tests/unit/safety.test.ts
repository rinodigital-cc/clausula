import { test } from "node:test";
import assert from "node:assert/strict";
import { assertDisposableDatabase } from "../safety";

const local = { DATABASE_URL_ADMIN: "postgres://localhost:55432/apoia_test", ALLOW_TEST_DB_RESET: "1" };

test("aceita somente banco local descartável com autorização explícita", () => {
  assert.doesNotThrow(() => assertDisposableDatabase(local));
  for (const env of [
    {},
    { ...local, ALLOW_TEST_DB_RESET: "0" },
    { ...local, DATABASE_URL_ADMIN: "postgres://localhost/production" },
    { ...local, DATABASE_URL_ADMIN: "postgres://db.example.test/apoia_test" },
    { ...local, DATABASE_URL: "postgres://db.example.test/production" },
    { ...local, WORKER_DATABASE_URL: "postgres://localhost:55432/other_test" },
  ]) assert.throws(() => assertDisposableDatabase(env));
});
