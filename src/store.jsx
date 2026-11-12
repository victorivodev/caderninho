import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { seedState, currentMk, migrate } from './lib.js';

const Ctx = createContext(null);
export const useApp = () => useContext(Ctx);

// sessão expirou ou foi encerrada em outro lugar: volta para a tela de login
const expired = (r) => { if (r.status === 401) { location.reload(); return true; } return false; };

// Sincronização segura entre aparelhos/abas:
// - cada gravação no servidor leva a versão (_rev) em que foi baseada;
// - se o servidor já tiver uma versão mais nova (outro aparelho, importação), ele recusa (409) e devolve a atual;
// - o app então reaplica, por cima da versão atual, as alterações feitas aqui que ainda não foram salvas, e grava de novo.
// Assim nenhum aparelho com dados velhos sobrescreve o que foi feito em outro lugar.
const strip = (s) => { const { _rev, ...rest } = s || {}; return rest; };

export function AppProvider({ user, children }) {
  const LS = `fin-pessoal-state:${user.id}`; // cópia local separada por pessoa
  const [state, setStateRaw] = useState(null);
  const [M, setM] = useState(currentMk());
  const [form, setForm] = useState(null); // {type, data}
  const [route, setRoute] = useState(() => location.hash.replace('#', '') || '/');
  const [saveStatus, setSaveStatus] = useState('ok');
  const stateRef = useRef(null);
  const revRef = useRef(0);
  const queue = useRef([]); // alterações locais ainda não confirmadas pelo servidor
  const saving = useRef(false);
  const timer = useRef(null);

  const setLocal = (s) => { stateRef.current = s; setStateRaw(s); };

  useEffect(() => {
    const onHash = () => setRoute(location.hash.replace('#', '') || '/');
    window.addEventListener('hashchange', onHash);
    return () => window.removeEventListener('hashchange', onHash);
  }, []);

  // carga inicial
  useEffect(() => {
    (async () => {
      let s = null;
      try {
        const r = await fetch('/api/state', { cache: 'no-store' });
        if (expired(r)) return;
        if (r.ok) s = await r.json();
      } catch {}
      if (s) revRef.current = s._rev || 0;
      if (!s) { try { s = JSON.parse(localStorage.getItem(LS)); } catch {} }
      if (!s) { s = seedState(); s.profile = { ...s.profile, name: user.name }; }
      setLocal(migrate(strip(s)));
    })();
  }, []);

  // tema + cópia local (não grava no servidor)
  useEffect(() => {
    if (!state) return;
    document.documentElement.dataset.theme = state.theme || 'light';
    document.querySelector('meta[name=theme-color]')?.setAttribute('content', state.theme === 'dark' ? '#0b0c0f' : '#f4f5f7');
    try { localStorage.setItem(LS, JSON.stringify(state)); } catch {}
  }, [state]);

  const flush = useCallback(async () => {
    if (saving.current || !queue.current.length || !stateRef.current) return;
    saving.current = true;
    setSaveStatus('saving');
    const sent = queue.current.length;
    try {
      const r = await fetch('/api/state', {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...stateRef.current, _rev: revRef.current }),
      });
      if (expired(r)) return;
      if (r.ok) {
        const { rev } = await r.json();
        revRef.current = rev;
        queue.current.splice(0, sent);
        setSaveStatus('ok');
      } else if (r.status === 409) {
        // alguém salvou antes: pega a versão atual e reaplica o que foi feito aqui
        const server = await r.json();
        revRef.current = server._rev || 0;
        const merged = migrate(strip(server));
        for (const fn of queue.current) fn(merged);
        setLocal(merged);
        setSaveStatus('saving');
        saving.current = false;
        return flush();
      } else setSaveStatus('error');
    } catch { setSaveStatus('error'); }
    saving.current = false;
    if (queue.current.length) { clearTimeout(timer.current); timer.current = setTimeout(flush, 3000); }
  }, []);

  const schedule = useCallback(() => {
    clearTimeout(timer.current);
    timer.current = setTimeout(flush, 350);
  }, [flush]);

  // ao voltar para o app (ou a cada 20s com ele aberto), busca a versão mais nova se não houver nada pendente aqui
  const refresh = useCallback(async () => {
    if (queue.current.length || saving.current) return;
    try {
      const r = await fetch('/api/state', { cache: 'no-store' });
      if (expired(r) || !r.ok) return;
      const s = await r.json();
      if (s && (s._rev || 0) !== revRef.current && !queue.current.length) {
        revRef.current = s._rev || 0;
        setLocal(migrate(strip(s)));
      }
    } catch {}
  }, []);
  useEffect(() => {
    const onVis = () => document.visibilityState === 'visible' && refresh();
    document.addEventListener('visibilitychange', onVis);
    window.addEventListener('focus', onVis);
    const iv = setInterval(onVis, 20000);
    return () => { document.removeEventListener('visibilitychange', onVis); window.removeEventListener('focus', onVis); clearInterval(iv); };
  }, [refresh]);

  const update = useCallback((fn) => {
    queue.current.push(fn);
    const n = structuredClone(stateRef.current);
    fn(n);
    setLocal(n);
    schedule();
  }, [schedule]);

  // substituir tudo (importar backup, começar do zero, dados de exemplo)
  const replaceState = useCallback((next) => {
    const snap = structuredClone(next);
    update((d) => { for (const k of Object.keys(d)) delete d[k]; Object.assign(d, structuredClone(snap)); });
  }, [update]);

  const logout = useCallback(async () => {
    try { await flush(); } catch {}
    try { localStorage.removeItem(LS); } catch {}
    await fetch('/api/logout', { method: 'POST' }).catch(() => {});
    location.hash = '';
    location.reload();
  }, [flush]);

  const go = useCallback((r) => { location.hash = r; window.scrollTo({ top: 0 }); }, []);
  const openForm = useCallback((type, data) => setForm({ type, data }), []);
  const togglePaid = useCallback((Mk, id, v) => update((s) => {
    s.payments[Mk] = s.payments[Mk] || {};
    if (v) s.payments[Mk][id] = true; else delete s.payments[Mk][id];
  }), [update]);

  if (!state) return <div className="boot"><div className="spinner" /></div>;
  return (
    <Ctx.Provider value={{ state, setState: replaceState, update, M, setM, form, setForm, openForm, route, go, togglePaid, saveStatus, refresh, user, logout }}>
      {children}
    </Ctx.Provider>
  );
}
