import { readFileSync, existsSync, readdirSync } from 'node:fs';

const checks = [];
const add = (name, ok, detail) => checks.push({name, ok, detail});
const pkg = JSON.parse(readFileSync('package.json','utf8'));
add('Next.js', !!pkg.dependencies?.next, 'Aplicacao Next.js');
add('Lockfile', existsSync('package-lock.json'), 'npm ci requer lockfile');
add('Dependencias instaladas', existsSync('node_modules/next/package.json'), 'Instalar com npm ci');
add('Worker independente', existsSync('services/worker/index.ts'), 'Precisa de processo continuo');
add('Storage persistente', existsSync('src/lib/storage.ts'), 'Usar volume compartilhado ou adaptacao object storage');
add('Compose homologacao', existsSync('compose.homologacao.yml'), 'Configuracao de web + worker');
add('Migrações', readdirSync('db/migrations').filter(x=>x.endsWith('.sql')).length >= 14, 'Migracoes versionadas presentes');
add('Painel plataforma', existsSync('src/app/plataforma/page.tsx'), 'Necessario para provisionar corretoras via interface');
add('Testes E2E implementados', existsSync('tests/e2e') && readdirSync('tests/e2e').some(x=>/\.spec\.[jt]s$/.test(x)), 'Nao basta diretório vazio');
for (const name of ['DATABASE_URL','BOOTSTRAP_DATABASE_URL','PLATFORM_DATABASE_URL','WORKER_DATABASE_URL','PUBLIC_DATABASE_URL','SESSION_SECRET','APP_URL']) {
  add(`Configuracao ${name}`, Boolean(process.env[name]), 'Obrigatoria em ambiente implantado');
}
console.log('ApoIA Seguro — preflight de homologacao (nao substitui npm test/build)');
for (const x of checks) console.log(`${x.ok ? 'OK ' : 'PENDENTE'} | ${x.name} | ${x.detail}`);
const pending = checks.filter(x=>!x.ok);
console.log(`\n${checks.length-pending.length}/${checks.length} verificacoes concluidas`);
process.exitCode = pending.length ? 1 : 0;
