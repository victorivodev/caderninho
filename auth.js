// Logins do Caderninho: cada pessoa tem usuário, senha e uma pasta própria de dados.
// - data/users.json: as pessoas (senha guardada só como hash scrypt)
// - data/sessions.json: as sessões abertas (guarda só o hash do token do cookie)
// - data/users/<id>/: state.json e pluggy.json de cada pessoa
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const COOKIE = 'caderninho_sessao';
const SESSION_DAYS = 90;
const MIN_PASSWORD = 8;

export function createAuth(dataDir) {
  const USERS = path.join(dataDir, 'users.json');
  const SESSIONS = path.join(dataDir, 'sessions.json');
  const readJson = (f, fallback) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return fallback; } };
  const writeJson = (f, v) => { fs.writeFileSync(f + '.tmp', JSON.stringify(v, null, 1), { mode: 0o600 }); fs.renameSync(f + '.tmp', f); };

  const listUsers = () => readJson(USERS, []);
  const saveUsers = (u) => writeJson(USERS, u);
  const userDir = (id) => {
    if (!/^[a-z0-9]+$/.test(id)) throw new Error('id de usuário inválido');
    const d = path.join(dataDir, 'users', id);
    fs.mkdirSync(d, { recursive: true });
    return d;
  };
  const publicUser = (u) => ({ id: u.id, login: u.login, name: u.name });
  const normLogin = (s) => String(s || '').trim().toLowerCase();

  const hashPassword = (password, salt = crypto.randomBytes(16).toString('hex')) =>
    ({ salt, hash: crypto.scryptSync(String(password), salt, 64).toString('hex') });
  const checkPassword = (u, password) => {
    const { hash } = hashPassword(password, u.salt);
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(u.hash, 'hex'));
  };

  function addUser(login, name, password) {
    login = normLogin(login);
    if (!/^[a-z0-9._-]{2,32}$/.test(login)) throw new Error('Usuário deve ter de 2 a 32 letras minúsculas, números, ponto, hífen ou _');
    if (String(password || '').length < MIN_PASSWORD) throw new Error(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    const users = listUsers();
    if (users.some((u) => u.login === login)) throw new Error(`Já existe o usuário "${login}"`);
    const u = { id: crypto.randomBytes(6).toString('hex'), login, name: String(name || login).trim(), ...hashPassword(password), createdAt: new Date().toISOString() };
    users.push(u);
    saveUsers(users);
    userDir(u.id);
    return u;
  }
  function setPassword(login, password) {
    if (String(password || '').length < MIN_PASSWORD) throw new Error(`A senha precisa ter pelo menos ${MIN_PASSWORD} caracteres`);
    const users = listUsers();
    const u = users.find((x) => x.login === normLogin(login));
    if (!u) throw new Error(`Usuário "${login}" não existe`);
    Object.assign(u, hashPassword(password));
    saveUsers(users);
    revokeSessions(u.id);
    return u;
  }
  function removeUser(login) {
    const users = listUsers();
    const u = users.find((x) => x.login === normLogin(login));
    if (!u) throw new Error(`Usuário "${login}" não existe`);
    saveUsers(users.filter((x) => x.id !== u.id));
    revokeSessions(u.id);
    return u; // a pasta de dados fica no disco (apague à mão se quiser)
  }

  // ---------- sessões ----------
  const tokenHash = (t) => crypto.createHash('sha256').update(t).digest('hex');
  const loadSessions = () => {
    const all = readJson(SESSIONS, {});
    const now = Date.now();
    for (const k of Object.keys(all)) if (all[k].exp < now) delete all[k];
    return all;
  };
  function createSession(userId) {
    const token = crypto.randomBytes(32).toString('base64url');
    const all = loadSessions();
    all[tokenHash(token)] = { userId, exp: Date.now() + SESSION_DAYS * 86400e3 };
    writeJson(SESSIONS, all);
    return token;
  }
  function revokeSession(token) {
    const all = loadSessions();
    delete all[tokenHash(token)];
    writeJson(SESSIONS, all);
  }
  function revokeSessions(userId) {
    const all = loadSessions();
    for (const k of Object.keys(all)) if (all[k].userId === userId) delete all[k];
    writeJson(SESSIONS, all);
  }
  const tokenOf = (req) => {
    const m = (req.headers.cookie || '').match(new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`));
    return m ? m[1] : null;
  };
  function userFromRequest(req) {
    const t = tokenOf(req);
    if (!t) return null;
    const s = loadSessions()[tokenHash(t)];
    if (!s) return null;
    return listUsers().find((u) => u.id === s.userId) || null;
  }
  const cookieHeader = (req, token, maxAge) => {
    const secure = req.headers['x-forwarded-proto'] === 'https' || req.socket.encrypted || process.env.COOKIE_SECURE === '1';
    return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? '; Secure' : ''}`;
  };

  // ---------- tentativas de login (trava após muitos erros) ----------
  const fails = new Map(); // chave -> { n, until }
  const WINDOW = 15 * 60e3;
  const blocked = (key) => { const f = fails.get(key); return f && f.n >= 10 && f.until > Date.now(); };
  const fail = (key) => { const f = fails.get(key); const n = f && f.until > Date.now() ? f.n + 1 : 1; fails.set(key, { n, until: Date.now() + WINDOW }); };

  function login(req, loginName, password) {
    const ip = req.socket.remoteAddress || '?';
    const keys = [`ip:${ip}`, `u:${normLogin(loginName)}`];
    if (keys.some(blocked)) return { error: 'Muitas tentativas. Espere 15 minutos.', code: 429 };
    const u = listUsers().find((x) => x.login === normLogin(loginName));
    // compara mesmo sem usuário, para não denunciar quais usuários existem pelo tempo de resposta
    const ok = u ? checkPassword(u, password) : (hashPassword(password), false);
    if (!ok) { keys.forEach(fail); return { error: 'Usuário ou senha incorretos', code: 401 }; }
    keys.forEach((k) => fails.delete(k));
    return { user: u, token: createSession(u.id) };
  }

  return { listUsers, publicUser, userDir, addUser, setPassword, removeUser, checkPassword, login, revokeSession, revokeSessions, userFromRequest, tokenOf, cookieHeader, MIN_PASSWORD };
}

// dados da versão de uma pessoa só (data/state.json, data/pluggy.json): passam para o primeiro usuário criado
export function migrateLegacy(dataDir, userId, auth) {
  const moved = [];
  const dest = auth.userDir(userId);
  for (const f of ['state.json', 'state.json.bak', 'pluggy.json']) {
    const src = path.join(dataDir, f);
    if (fs.existsSync(src) && !fs.existsSync(path.join(dest, f))) { fs.renameSync(src, path.join(dest, f)); moved.push(f); }
  }
  return moved;
}
