import React, { useState } from 'react';
import {
  LayoutGrid, ArrowLeftRight, CreditCard, Building2, Vault, Banknote, Home, ChevronLeft, ChevronRight,
  ChevronDown, Bell, Plus, Sun, Moon, Menu, X, Receipt, ShoppingBag, PiggyBank, TrendingUp, ChevronUp, House, HandCoins, Landmark, Inbox, Heart, LogOut, KeyRound,
} from 'lucide-react';
import { useApp } from './store.jsx';
import { FORMS } from './forms.jsx';
import { useOutside, BillIcon, useBackClose, Modal } from './ui.jsx';
import { MONTHS, MONTHS_SHORT, parseMk, mk, addMonths, notifications, reviewQueue, brl, currentMk } from './lib.js';
import Dashboard from './pages/Dashboard.jsx';
import Fluxo from './pages/Fluxo.jsx';
import Cartoes from './pages/Cartoes.jsx';
import Casa from './pages/Casa.jsx';
import Reserva from './pages/Reserva.jsx';
import Renda from './pages/Renda.jsx';
import Contas from './pages/Contas.jsx';
import Receber from './pages/Receber.jsx';
import Bancos from './pages/Bancos.jsx';
import Revisar from './pages/Revisar.jsx';
import Casal from './pages/Casal.jsx';

const NAV = [
  { r: '/', label: 'Visão geral', icon: LayoutGrid },
  { r: '/casal', label: 'Nós dois', icon: Heart },
  { r: '/revisar', label: 'Para revisar', icon: Inbox, count: true },
  { r: '/fluxo', label: 'Fluxo de caixa', icon: ArrowLeftRight },
  { r: '/cartoes', label: 'Cartões', icon: CreditCard },
  { r: '/receber', label: 'A receber', icon: HandCoins },
  { r: '/casa', label: 'Minha casa', icon: Building2 },
  { r: '/reserva', label: 'Minha reserva', icon: Vault },
];
const NAV2 = [
  { r: '/renda', label: 'Minha renda', icon: Banknote },
  { r: '/contas', label: 'Contas fixas', icon: Home },
  { r: '/bancos', label: 'Bancos conectados', icon: Landmark },
];
const PAGES = { '/': Dashboard, '/fluxo': Fluxo, '/cartoes': Cartoes, '/casa': Casa, '/reserva': Reserva, '/renda': Renda, '/contas': Contas, '/receber': Receber, '/bancos': Bancos, '/revisar': Revisar, '/casal': Casal };

function Brand() {
  return (
    <div className="brand">
      <img className="brand-logo" src="/favicon.svg?v=3" alt="" width={36} height={36} />
      <div>
        <b>Caderninho</b>
        <small>Finanças do casal</small>
      </div>
    </div>
  );
}

function Sidebar({ open, onClose }) {
  const { route, go, state, update, user, logout } = useApp();
  useBackClose(open, onClose);
  const [pwd, setPwd] = useState(false);
  const pending = reviewQueue(state).length;
  const item = (n) => (
    <button key={n.r} className={`nav-item ${route === n.r ? 'on' : ''}`} onClick={() => { go(n.r); onClose(); }}>
      <n.icon size={16} strokeWidth={route === n.r ? 2.2 : 1.8} />
      {n.label}
      {n.count && pending > 0 && <span className="nav-count">{pending}</span>}
    </button>
  );
  return (
    <>
      <div className={`scrim ${open ? 'show' : ''}`} onClick={onClose} />
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="side-top">
          <Brand />
          <button className="icon-btn ghost only-mobile" onClick={onClose} aria-label="Fechar menu"><X size={18} /></button>
        </div>
        <div className="nav-label">Menu</div>
        <nav>{NAV.map(item)}</nav>
        <div className="nav-label">Ajustes</div>
        <nav>{NAV2.map(item)}</nav>
        <div style={{ flex: 1 }} />
        <div className="theme-row">
          <span><Sun size={15} /> Tema</span>
          <div className="theme-toggle">
            <button className={state.theme !== 'dark' ? 'on' : ''} onClick={() => update((s) => { s.theme = 'light'; })} aria-label="Tema claro"><Sun size={14} /></button>
            <button className={state.theme === 'dark' ? 'on' : ''} onClick={() => update((s) => { s.theme = 'dark'; })} aria-label="Tema escuro"><Moon size={14} /></button>
          </div>
        </div>
        <div className="profile">
          <span className="av blue">{(user.name || 'V')[0].toUpperCase()}</span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <b className="ellipsis">{user.name}</b>
            <small>@{user.login}</small>
          </div>
          <button className="icon-btn ghost" onClick={() => setPwd(true)} aria-label="Trocar senha" title="Trocar senha"><KeyRound size={15} /></button>
          <button className="icon-btn ghost" onClick={logout} aria-label="Sair" title="Sair"><LogOut size={15} /></button>
        </div>
        {pwd && <PasswordModal onClose={() => setPwd(false)} />}
      </aside>
    </>
  );
}

function PasswordModal({ onClose }) {
  const [cur, setCur] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [msg, setMsg] = useState(null);
  const save = async () => {
    if (next !== again) return setMsg({ err: 'As senhas novas não conferem' });
    const r = await fetch('/api/password', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ current: cur, next }) });
    const j = await r.json().catch(() => ({}));
    setMsg(r.ok ? { ok: 'Senha trocada. Os outros aparelhos vão pedir login de novo.' } : { err: j.error || `Erro ${r.status}` });
  };
  return (
    <Modal title="Trocar senha" onClose={onClose}
      footer={msg?.ok ? <button className="btn primary" onClick={onClose}>Fechar</button>
        : <button className="btn primary" disabled={!cur || !next || !again} onClick={save}>Salvar</button>}>
      <label className="field"><span className="field-label">Senha atual</span><input type="password" autoComplete="current-password" value={cur} onChange={(e) => setCur(e.target.value)} /></label>
      <label className="field"><span className="field-label">Senha nova</span><input type="password" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} /></label>
      <label className="field"><span className="field-label">Repita a senha nova</span><input type="password" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} /></label>
      {msg?.err && <p className="login-err">{msg.err}</p>}
      {msg?.ok && <p className="meta">{msg.ok}</p>}
    </Modal>
  );
}

function MonthPicker() {
  const { M, setM } = useApp();
  const [open, setOpen] = useState(false);
  const { y, m } = parseMk(M);
  const [yy, setYy] = useState(y);
  const ref = useOutside(open, setOpen);
  return (
    <div className="month-nav" ref={ref}>
      <button className="icon-btn ghost faint" onClick={() => setM(addMonths(M, -1))} aria-label="Mês anterior"><ChevronLeft size={18} /></button>
      <button className="icon-btn ghost" onClick={() => setM(addMonths(M, 1))} aria-label="Próximo mês"><ChevronRight size={18} /></button>
      <button className="month-title" onClick={() => { setYy(y); setOpen(!open); }}>
        <b>{MONTHS[m]}</b> <span>{y}</span> <ChevronDown size={16} />
      </button>
      {open && (
        <div className="pop month-pop">
          <div className="pop-year">
            <button className="icon-btn ghost" onClick={() => setYy(yy - 1)}><ChevronLeft size={16} /></button>
            <b>{yy}</b>
            <button className="icon-btn ghost" onClick={() => setYy(yy + 1)}><ChevronRight size={16} /></button>
          </div>
          <div className="pop-months">
            {MONTHS_SHORT.map((n, i) => (
              <button key={n} className={`${mk(yy, i) === M ? 'on' : ''} ${mk(yy, i) === currentMk() ? 'today' : ''}`} onClick={() => { setM(mk(yy, i)); setOpen(false); }}>{n}</button>
            ))}
          </div>
          <button className="btn small block" onClick={() => { setM(currentMk()); setOpen(false); }}>Ir para o mês atual</button>
        </div>
      )}
    </div>
  );
}

function Notifications() {
  const { state, setM, go } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, setOpen);
  const list = notifications(state);
  const pending = reviewQueue(state).length;
  return (
    <div className="rel" ref={ref}>
      <button className="icon-btn bordered" onClick={() => setOpen(!open)} aria-label="Notificações">
        <Bell size={18} />
        {list.length + (pending ? 1 : 0) > 0 && <span className="badge">{list.length + (pending ? 1 : 0)}</span>}
      </button>
      {open && (
        <div className="pop notif-pop">
          <div className="pop-title">Avisos</div>
          {pending > 0 && (
            <button className="notif" onClick={() => { go('/revisar'); setOpen(false); }}>
              <span className="tile blue"><Inbox size={16} /></span>
              <span className="grow"><b>Para revisar</b><small>{pending} lançamento{pending > 1 ? 's' : ''} dos bancos esperando você</small></span>
            </button>
          )}
          {list.length === 0 && !pending && <div className="empty small">Nada vencendo nos próximos dias 🎉</div>}
          {list.map((n) => (
            <button key={n.M + n.id} className="notif" onClick={() => { setM(n.M); go(n.kind === 'card' ? '/cartoes' : '/'); setOpen(false); }}>
              <span className={`tile ${n.days < 0 ? 'red' : n.days <= 1 ? 'orange' : ''}`}><BillIcon name={n.icon} size={16} /></span>
              <span className="grow">
                <b>{n.name}</b>
                <small>{n.days < 0 ? `venceu há ${-n.days} dia${n.days < -1 ? 's' : ''}` : n.days === 0 ? 'vence hoje' : n.days === 1 ? 'vence amanhã' : `vence em ${n.days} dias`}</small>
              </span>
              <b className="nowrap">{brl(n.amount)}</b>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

const ADD_OPTS = [
  { type: 'tx', data: { type: 'out' }, label: 'Gasto', desc: 'Débito, pix ou dinheiro', icon: ShoppingBag },
  { type: 'tx', data: { type: 'in' }, label: 'Receita', desc: 'Dinheiro que entrou', icon: TrendingUp },
  { type: 'purchase', label: 'Compra no cartão', desc: 'À vista, parcelada ou assinatura', icon: CreditCard },
  { type: 'bill', label: 'Conta fixa', desc: 'Aluguel, luz, academia…', icon: Receipt },
  { type: 'reserve', label: 'Guardar na reserva', desc: 'Aporte ou resgate', icon: PiggyBank },
];

function AddMenu({ list, onPick }) {
  return (
    <div className={`pop add-pop ${list ? 'sheet' : ''}`}>
      {ADD_OPTS.map((o) => (
        <button key={o.label} className="add-opt" onClick={() => onPick(o)}>
          <span className="tile"><o.icon size={17} strokeWidth={1.8} /></span>
          <span className="grow"><b>{o.label}</b><small>{o.desc}</small></span>
        </button>
      ))}
    </div>
  );
}

function AddButton() {
  const { openForm } = useApp();
  const [open, setOpen] = useState(false);
  const ref = useOutside(open, setOpen);
  return (
    <div className="split rel" ref={ref}>
      <button className="btn primary" onClick={() => openForm('tx', { type: 'out' })}><Plus size={16} strokeWidth={2.4} /> Adicionar</button>
      <button className="btn primary caret" onClick={() => setOpen(!open)} aria-label="Mais opções"><ChevronDown size={16} /></button>
      {open && <AddMenu onPick={(o) => { setOpen(false); openForm(o.type, o.data); }} />}
    </div>
  );
}

function Fab() {
  const { openForm } = useApp();
  const [open, setOpen] = useState(false);
  useBackClose(open, () => setOpen(false));
  return (
    <>
      <button className="fab" onClick={() => setOpen(true)} aria-label="Adicionar"><Plus size={26} strokeWidth={2.4} /></button>
      {open && (
        <div className="overlay sheet-wrap" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
          <div className="sheet-box">
            <div className="grabber" />
            <h3>Adicionar</h3>
            <AddMenu list onPick={(o) => { setOpen(false); openForm(o.type, o.data); }} />
          </div>
        </div>
      )}
    </>
  );
}

function BottomNav() {
  const { route, go } = useApp();
  const items = [
    { r: '/', label: 'Início', icon: House },
    { r: '/fluxo', label: 'Fluxo', icon: ArrowLeftRight },
    { r: '/cartoes', label: 'Cartões', icon: CreditCard },
    { r: '/receber', label: 'Receber', icon: HandCoins },
    { r: '/casa', label: 'Casa', icon: Building2 },
  ];
  return (
    <div className="bottom-bar">
      <nav className="bottom-nav">
        {items.map((n) => (
          <button key={n.r} className={route === n.r ? 'on' : ''} onClick={() => go(n.r)}>
            <n.icon size={20} strokeWidth={route === n.r ? 2.3 : 1.7} fill={route === n.r && n.r === '/' ? 'currentColor' : 'none'} />
            <span>{n.label}</span>
          </button>
        ))}
      </nav>
      <Fab />
    </div>
  );
}

export default function App() {
  const { route, form, setForm, saveStatus, state } = useApp();
  const pending = reviewQueue(state).length;
  const [menu, setMenu] = useState(false);
  const Page = PAGES[route] || Dashboard;
  const Form = form && FORMS[form.type];
  return (
    <div className="app">
      <Sidebar open={menu} onClose={() => setMenu(false)} />
      <main className="main">
        <header className="mobile-head card">
          <button className="icon-btn ghost" onClick={() => setMenu(true)} aria-label="Abrir menu"><Menu size={22} />{pending > 0 && <span className="menu-dot" />}</button>
          <Brand />
          <Notifications />
        </header>
        <header className="topbar card">
          <MonthPicker />
          <div className="top-actions">
            {saveStatus === 'error' && <span className="save-err">offline — salvo só neste aparelho</span>}
            <span className="hide-mobile"><Notifications /></span>
            <span className="hide-mobile"><AddButton /></span>
          </div>
        </header>
        <Page key={route} />
      </main>
      <BottomNav />
      {Form && <Form data={form.data} onClose={() => setForm(null)} />}
    </div>
  );
}
