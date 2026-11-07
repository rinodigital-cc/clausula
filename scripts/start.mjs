import path from "node:path";

// O Next standalone muda cwd. Web e worker devem resolver o mesmo volume.
process.env.STORAGE_DIR = path.resolve(process.env.STORAGE_DIR ?? "./storage");
await import("../.next/standalone/server.js");
