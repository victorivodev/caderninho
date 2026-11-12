import React, { useEffect, useState } from 'react';
import { useApp } from '../store.jsx';
import { Money, Empty } from '../ui.jsx';
import { PageHead } from './Fluxo.jsx';
import { brl, monthName, round2 } from '../lib.js';

// Nós dois: os totais do mês de cada pessoa lado a lado. Cada um só vê os próprios lançamentos;
// aqui aparecem apenas os números consolidados de quem tem login neste Caderninho.
const ROWS = [
  ['income', 'Entrou', 'renda + extras'],
  ['casa', 'Contas da casa', 'a parte de cada um'],
  ['pessoais', 'Contas pessoais e faturas', null],
  ['diaADia', 'Dia a dia', 'Pix, débito, dinheiro'],
];

export default function Casal() {
  const { M, user } = useApp();
  const [data, setData] = useState(null);
  const [err, setErr] = useState('');
  useEffect(() => {
    let alive = true;
    setErr('');
    fetch(`/api/casal?M=${M}`, { cache: 'no-store' })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || `Erro ${r.status}`); return j; })
      .then((j) => alive && setData(j))
      .catch((e) => alive && setErr(e.message));
    return () => { alive = false; };
  }, [M]);

  const people = (data?.people || []).filter((p) => !p.empty);
  const total = (k) => round2(people.reduce((s, p) => s + (p.summary?.[k] || 0), 0));
  const sobra = total('sobra');
  return (
    <div className="page">
      <PageHead title="Nós dois" icon="balance_scale" value={sobra}
        sub={`quanto sobra para o casal em ${monthName(M).toLowerCase()}, somando ${people.length > 1 ? people.map((p) => p.name).join(' e ') : 'quem já usa o app'}`} />
      {err && <section className="card"><p className="login-err">{err}</p></section>}
      {data && people.length < 2 && (
        <section className="card"><Empty>Só {people[0]?.name || 'você'} tem dados por enquanto. Crie o login da outra pessoa com <code>npm run usuario -- criar usuario "Nome"</code>.</Empty></section>
      )}
      <div className="couple-grid">
        {people.map((p) => (
          <section key={p.id} className="card couple-card">
            <div className="card-head">
              <h2><span className={`av ${p.id === user.id ? 'blue' : 'green'}`}>{p.name[0]?.toUpperCase()}</span> {p.name}{p.id === user.id && <span className="sub"> · você</span>}</h2>
              {p.sample && <span className="tag yellow">dados de exemplo</span>}
            </div>
            {ROWS.map(([k, label, hint]) => (
              <div key={k} className="list-row">
                <span className="grow"><b>{label}</b>{hint && <small>{hint}</small>}</span>
                <b className="nowrap">{brl(p.summary[k])}</b>
              </div>
            ))}
            <div className="list-row">
              <span className="grow"><b>Sobra</b></span>
              <Money v={p.summary.sobra} size="md" />
            </div>
            <p className="meta">Reserva: <b>{brl(p.reserve)}</b>{p.toReview > 0 && <> · {p.toReview} lançamento{p.toReview > 1 ? 's' : ''} para revisar</>}</p>
          </section>
        ))}
        {people.length > 1 && (
          <section className="card couple-card">
            <div className="card-head"><h2>Casal</h2></div>
            {ROWS.map(([k, label]) => (
              <div key={k} className="list-row"><span className="grow"><b>{label}</b></span><b className="nowrap">{brl(total(k))}</b></div>
            ))}
            <div className="list-row"><span className="grow"><b>Sobra</b></span><Money v={sobra} size="md" /></div>
            <p className="meta">Reserva somada: <b>{brl(round2(people.reduce((s, p) => s + p.reserve, 0)))}</b></p>
          </section>
        )}
      </div>
    </div>
  );
}
