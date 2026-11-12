import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { setupPluggy } from './pluggy.js';
import { createAuth } from './auth.js';
import { migrate, monthSummary, reserveTotal, reviewQueue, currentMk } from './src/lib.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ENV_FILE = path.join(__dirname, '.env');
try { process.loadEnvFile(ENV_FILE); } catch {}
const PORT = Number(process.env.PORT || 4320);
const HOST = process.env.HOST || '127.0.0.1';
const DIST = path.join(__dirname, 'dist');
const DATA_DIR = path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const auth = createAuth(DATA_DIR);

const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css',
  '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
  '.webmanifest': 'application/manifest+json', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};
const log = (m) => console.log(`[${new Date().toLocaleString('pt-BR')}] ${m}`);

// ---------- dados de cada pessoa (data/users/<id>/state.json) ----------
const stateFile = (userId) => path.join(auth.userDir(userId), 'state.json');
const readState = (userId) => { const f = stateFile(userId); return fs.existsSync(f) ? JSON.parse(fs.readFileSync(f, 'utf8')) : null; };
const writeState = (userId, next, cur) => {
  const f = stateFile(userId);
  next._rev = (cur?._rev || 0) + 1;
  if (cur) fs.copyFileSync(f, f + '.bak');
  fs.writeFileSync(f + '.tmp', JSON.stringify(next));
  fs.renameSync(f + '.tmp', f);
  return next._rev;
};
// alteração feita pelo servidor (sincronização com o banco): lê, aplica e grava de uma vez (síncrono)
const mutateState = (userId, fn) => {
  const cur = readState(userId);
  if (!cur) throw new Error('Estado do app ainda não existe');
  const next = structuredClone(cur);
  fn(next);
  return writeState(userId, next, cur);
};

// uma integração com a Pluggy por pessoa: cada uma conecta os próprios bancos
const pluggies = new Map();
const pluggyOf = (u) => {
  if (!pluggies.has(u.id)) {
    pluggies.set(u.id, setupPluggy({
      dataDir: auth.userDir(u.id), envFile: ENV_FILE, clientUserId: `caderninho-${u.id}`,
      readState: () => readState(u.id), mutateState: (fn) => mutateState(u.id, fn),
      log: (m) => log(`[${u.login}] ${m}`),
    }));
  }
  return pluggies.get(u.id);
};
for (const u of auth.listUsers()) pluggyOf(u); // liga a sincronização diária de todo mundo

// ---------- http ----------
function send(res, code, body, type = 'application/json', headers = {}) {
  res.writeHead(code, { 'Content-Type': type, 'Cache-Control': 'no-store', ...headers });
  res.end(body);
}
const json = (res, code, obj, headers) => send(res, code, JSON.stringify(obj), 'application/json', headers);
const readBody = (req, limit) => new Promise((ok, fail) => {
  let b = '';
  req.on('data', (c) => { b += c; if (b.length > limit) { req.destroy(); fail(new Error('grande demais')); } });
  req.on('end', () => ok(b));
  req.on('error', fail);
});
const readJson = async (req) => { try { return JSON.parse((await readBody(req, 1e5)) || '{}'); } catch { return {}; } };

// visão do casal: só os totais do mês de cada pessoa, sem os lançamentos
function casal(M) {
  return auth.listUsers().map((u) => {
    const raw = readState(u.id);
    if (!raw) return { ...auth.publicUser(u), empty: true };
    const s = migrate(structuredClone(raw));
    return { ...auth.publicUser(u), sample: !!s.sample, summary: monthSummary(s, M), reserve: reserveTotal(s), toReview: reviewQueue(s).length };
  });
}

async function api(req, res, url) {
  const p = url.pathname;
  if (p === '/api/login' && req.method === 'POST') {
    const { login, password } = await readJson(req);
    const r = auth.login(req, login, password);
    if (r.error) return json(res, r.code, { error: r.error });
    pluggyOf(r.user);
    return json(res, 200, { user: auth.publicUser(r.user) }, { 'Set-Cookie': auth.cookieHeader(req, r.token, 90 * 86400) });
  }
  if (p === '/api/logout' && req.method === 'POST') {
    const t = auth.tokenOf(req);
    if (t) auth.revokeSession(t);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.cookieHeader(req, '', 0) });
  }

  const user = auth.userFromRequest(req);
  if (!user) return json(res, 401, { error: 'Entre com seu usuário', noUsers: auth.listUsers().length === 0 });

  if (p === '/api/me' && req.method === 'GET') return json(res, 200, { user: auth.publicUser(user) });
  if (p === '/api/password' && req.method === 'POST') {
    const { current, next } = await readJson(req);
    if (!auth.checkPassword(user, current || '')) return json(res, 400, { error: 'Senha atual incorreta' });
    try { auth.setPassword(user.login, next); } catch (e) { return json(res, 400, { error: e.message }); }
    // trocar a senha encerra as outras sessões; esta continua aberta com um token novo
    const r = auth.login(req, user.login, next);
    return json(res, 200, { ok: true }, { 'Set-Cookie': auth.cookieHeader(req, r.token, 90 * 86400) });
  }
  if (p === '/api/casal' && req.method === 'GET') {
    const M = url.searchParams.get('M') || currentMk();
    if (!/^\d{4}-\d{2}$/.test(M)) return json(res, 400, { error: 'mês inválido' });
    return json(res, 200, { M, me: user.id, people: casal(M) });
  }
  if (p.startsWith('/api/pluggy/')) return pluggyOf(user).handle(req, res, url);
  if (p === '/api/state') {
    if (req.method === 'GET') {
      const f = stateFile(user.id);
      return send(res, 200, fs.existsSync(f) ? fs.readFileSync(f) : 'null');
    }
    if (req.method === 'PUT') {
      try {
        const next = JSON.parse(await readBody(req, 20e6));
        const cur = readState(user.id);
        // gravação baseada numa versão antiga (outro aparelho/aba/sincronização salvou antes): recusa e devolve a atual
        if (cur && next._rev !== (cur._rev || 0)) return json(res, 409, cur);
        return json(res, 200, { ok: true, rev: writeState(user.id, next, cur) });
      } catch { return json(res, 400, { ok: false }); }
    }
    return json(res, 405, {});
  }
  return json(res, 404, { error: 'not found' });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  if (url.pathname.startsWith('/api/')) {
    return api(req, res, url).catch((e) => { log(`erro em ${url.pathname}: ${e?.message || e}`); if (!res.headersSent) json(res, 500, { error: 'erro interno' }); });
  }
  let file = path.normalize(path.join(DIST, decodeURIComponent(url.pathname)));
  if (!file.startsWith(DIST)) return send(res, 403, 'forbidden', 'text/plain');
  if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) file = path.join(DIST, 'index.html');
  const ext = path.extname(file);
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Cache-Control': file.includes(`${path.sep}assets${path.sep}`) ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  fs.createReadStream(file).pipe(res);
});

server.listen(PORT, HOST, () => {
  console.log(`Caderninho rodando em http://${HOST}:${PORT}`);
  if (!auth.listUsers().length) console.log('Nenhum usuário ainda. Crie o primeiro com: npm run usuario -- criar <usuario> "<Nome>"');
});
