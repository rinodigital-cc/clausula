import { execFileSync } from "node:child_process";

export default function setup() {
  execFileSync(process.execPath, ["--conditions=react-server", "--import", "tsx", "tests/e2e/seed.ts"], {
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "test", ANTHROPIC_API_KEY: "", RESEND_API_KEY: "", EMAIL_TRANSPORT: "file" },
  });
}
