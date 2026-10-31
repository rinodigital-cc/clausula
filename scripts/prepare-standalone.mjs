import { cpSync, mkdirSync } from "node:fs";

// O servidor standalone não copia assets automaticamente.
mkdirSync(".next/standalone/.next", { recursive: true });
cpSync(".next/static", ".next/standalone/.next/static", { recursive: true });
cpSync("public", ".next/standalone/public", { recursive: true });
