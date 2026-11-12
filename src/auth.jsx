import React, { useEffect, useState } from 'react';
import { LogIn } from 'lucide-react';

// verifica a sessão antes de abrir o app; sem sessão, mostra a tela de login
export function AuthGate({ children }) {
  const [st, setSt] = useState({ loading: true });
  useEffect(() => {
    fetch('/api/me', { cache: 'no-store' })
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        setSt(r.ok ? { user: j.user } : { noUsers: !!j.noUsers });
      })
      .catch(() => setSt({ offline: true }));
  }, []);
  if (st.loading) return <div className="boot"><div className="spinner" /></div>;
  if (st.user) return children(st.user);
  return <Login noUsers={st.noUsers} offline={st.offline} onLogin={(user) => setSt({ user })} />;
}

function Login({ noUsers, offline, onLogin }) {
  const [login, setLogin] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState(offline ? 'Não consegui falar com o servidor. Ele está rodando?' : '');
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault();
    setErr(''); setBusy(true);
    try {
      const r = await fetch('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ login, password }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Erro ${r.status}`);
      onLogin(j.user);
    } catch (e2) { setErr(e2.message); }
    setBusy(false);
  };
  return (
    <div className="login-wrap">
      <form className="card login-card" onSubmit={submit}>
        <div className="brand">
          <img className="brand-logo" src="/favicon.svg?v=3" alt="" width={36} height={36} />
          <div><b>Caderninho</b><small>Finanças do casal</small></div>
        </div>
        {noUsers ? (
          <p className="meta">Ainda não tem nenhum login. No computador onde o app roda, crie o primeiro com:<br />
            <code>npm run usuario -- criar seu-usuario "Seu nome"</code></p>
        ) : (
          <>
            <label className="field"><span className="field-label">Usuário</span>
              <input autoFocus autoComplete="username" autoCapitalize="none" value={login} onChange={(e) => setLogin(e.target.value)} /></label>
            <label className="field"><span className="field-label">Senha</span>
              <input type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></label>
            <button className="btn primary block" disabled={busy || !login || !password}><LogIn size={16} /> {busy ? 'Entrando…' : 'Entrar'}</button>
          </>
        )}
        {err && <p className="login-err">{err}</p>}
      </form>
    </div>
  );
}
