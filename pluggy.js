// Integração com a Pluggy (Open Finance via Meu Pluggy).
// - guarda as conexões (items) e o controle do que já foi importado em data/pluggy.json
// - sincroniza todo dia no horário PLUGGY_SYNC_HOUR (padrão 18h) e sob demanda
// - converte as transações dos bancos nos registros do app (purchases / transactions / contas pagas)
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';
import { PluggyClient } from 'pluggy-sdk';
import { uid, round2, billsForMonth, invoiceTotal, isPaid, iPay, salaryParts, receivables, purchaseDueMonth, addMonths as addMonthsKey, CATEGORIES } from './src/lib.js';

const SYNC_HOUR = Number(process.env.PLUGGY_SYNC_HOUR || 18);
const FIRST_SYNC_DAYS = 120; // primeira sincronização: busca ~4 meses (pega parcelas de compras antigas)
const OVERLAP_DAYS = 20; // sincronizações seguintes: reprocessa os últimos dias (bancos às vezes lançam com atraso)

// ---------- utilidades ----------
const DAY = 86400e3;
const ymd = (d) => {
  if (!d) return null;
  const dt = d instanceof Date ? d : new Date(d);
  if (isNaN(dt)) return null;
  const iso = dt.toISOString();
  // datas "só dia" chegam como meia-noite UTC (ou 03:00Z = meia-noite em Brasília)
  if (/T0[03]:00:00\.000Z$/.test(iso)) return iso.slice(0, 10);
  return dt.toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
};
const daysApart = (a, b) => Math.abs((new Date(a) - new Date(b)) / DAY);
const addDays = (dateStr, n) => new Date(new Date(dateStr).getTime() + n * DAY).toISOString().slice(0, 10);
const todayYmd = () => new Date().toLocaleDateString('sv-SE', { timeZone: 'America/Sao_Paulo' });
const norm = (s) => (s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const tokens = (s) => norm(s).split(' ').filter((w) => w.length >= 3 && !/^\d+$/.test(w));
const similar = (a, b) => {
  const A = new Set(tokens(a)); const B = tokens(b);
  return B.some((w) => A.has(w) || [...A].some((x) => x.startsWith(w) || w.startsWith(x)));
};
const titleCase = (s) => {
  if (!s) return s;
  if (s !== s.toUpperCase()) return s.trim();
  return s.toLowerCase().replace(/(^|[\s\-/(])(\p{L})/gu, (m, p, c) => p + c.toUpperCase()).trim();
};
const cleanDesc = (s) => titleCase((s || '').replace(/^(mercadolivre|mercado livre)\s*\*\s*/i, 'Mercado Livre — ').replace(/^[A-Za-z0-9]{1,6}\s?\*\s?(?=\S)/, '').replace(/\s*-?\s*parcela\s*\d+\s*(de|\/)\s*\d+/i, '').replace(/\s+\d{1,2}\/\d{1,2}$/, '').replace(/\s+/g, ' ').trim()) || 'Sem descrição';

const BANK_KEYS = [
  [/nubank|nu pagamentos/i, 'nubank'], [/santander/i, 'santander'], [/caixa/i, 'caixa'], [/ita[uú]/i, 'itau'],
  [/inter\b/i, 'inter'], [/c6/i, 'c6'], [/bradesco/i, 'bradesco'], [/banco do brasil|\bbb\b/i, 'bb'], [/\bxp\b/i, 'xp'],
];
const LABELS = { nubank: 'Nubank', santander: 'Santander', caixa: 'CAIXA', itau: 'Itaú', inter: 'Inter', c6: 'C6 Bank', bradesco: 'Bradesco', bb: 'Banco do Brasil', xp: 'XP' };
const institutionName = (accounts) => { for (const a of accounts) { const k = bankKey(`${a.name} ${a.marketingName || ''}`); if (k !== 'outro') return LABELS[k]; } return accounts[0]?.name || null; };
const bankKey = (name) => (BANK_KEYS.find(([re]) => re.test(name || '')) || [, 'outro'])[1];

// categorias da Pluggy (inglês) + descrição -> categorias do app
const CAT_RULES = [
  ['Assinaturas', /stream|subscription|assinatura|netflix|spotify|hbo|disney|prime video|amazon prime|google one|youtube|deezer|apple\.com|icloud|anthropic|claude|openai|chatgpt|software|ifood club/],
  ['Restaurante', /restaurant|eating out|food delivery|fast food|ifood|ifd\b|rappi|lanchonete|\blanche|pizzaria|hamburg|burger|cafe\b|cafeteria|coffee|\bbar\b|churrasc|sushi|padaria|bakery/],
  ['Compras', /mercado ?livre|mercadolivre|shopee|amazon|magalu|magazine luiza|aliexpress|shein|temu|americanas|casas bahia/],
  ['Mercado', /supermarket|grocer|supermerc|mercado|atacad|assai|carrefour|hortifruti|sacolao|acougue/],
  ['Transporte', /transport|taxi|ride.?hailing|\buber\b|\b99\b|99app|gas station|fuel|posto|combustiv|shell|ipiranga|parking|estacionamento|\btoll|pedagio|sem parar|veloe|car rental|localiza|movida|unidas|onibus|metro\b|bilhete unico/],
  ['Saúde', /health|pharmac|drogaria|farmacia|droga raia|drogasil|pague menos|hospital|dentist|odonto|clinic|laborat|medic|gym|fitness|academia|wellhub|gympass|smart fit/],
  ['Educação', /educa|school|escola|faculdade|universid|course|curso|udemy|alura|livraria|bookstore|\bbook/],
  ['Viagem', /travel|airline|airport|aeroporto|hotel|accommodation|lodging|hosped|airbnb|booking|decolar|avianca|latam|\bgol\b|azul linhas|voeazul|passagem/],
  ['Lazer', /entertain|leisure|cinema|ingresso|ticket|sympla|eventim|\bgame|steam|playstation|xbox|nintendo|sport|esporte|show\b|teatro/],
  ['Cuidados', /beauty|salon|salao|barber|barbearia|cosmet|perfum|boticario|natura|sephora/],
  ['Eletrônicos', /electronic|eletron|kabum|fast shop|apple store|samsung|dell\b|lenovo/],
  ['Pets', /\bpet|petz|cobasi|veterin/],
  ['Casa', /home|house|furniture|moveis|construction|hardware|material de constru|leroy|telha norte|tok ?stok|electricity|energia|water|saneamento|sabesp|internet|telecom|vivo|claro|\btim\b|\boi\b|rent\b|aluguel|housing|condominio/],
  ['Compras', /shopping|store|retail|clothing|vestuario|roupa|calcad|online|marketplace|loja/],
];
const toCategory = (tx, desc) => {
  const hay = norm(`${tx.category || ''} ${tx.merchant?.category || ''} ${tx.merchant?.name || ''} ${desc} ${tx.description || ''}`);
  for (const [cat, re] of CAT_RULES) if (re.test(hay) && CATEGORIES.includes(cat)) return cat;
  return 'Outros';
};

const isInvestment = (tx) => /APLIC|RESGATE|RENDIMENTO/i.test(tx.operationType || '') || /invest/i.test(tx.category || '') ||
  /aplicac|aplicacao|resgate|caixinha|\brdb\b|\bcdb\b|poupanca|tesouro|rendimento|guardad|dinheiro guardado|resgatado/.test(norm(tx.description));
const isCardBillPayment = (tx) => /credit card payment/i.test(tx.category || '') ||
  /pagamento (de )?fatura|pgto fatura|pagto fatura|fatura (do )?cart|pagamento cart/.test(norm(tx.description));
const isSalary = (tx) => /FOLHA|SALARIO/i.test(tx.operationType || '') || /salary|^income$/i.test(tx.category || '') || /salario|folha de pag|proventos|vencimentos/.test(norm(tx.description));
// pistas de nome/categoria para casar Pix com contas fixas pelo ícone da conta
const BILL_HINTS = {
  zap: /electric|energia|enel|light|cemig|copel|celesc|coelba|cpfl/, flame: /\bgas\b|comgas|naturgy|ultragaz/,
  phone: /telecom|telefonica|vivo|claro|\btim\b/, wifi: /internet|telecom|giganet|claro|vivo/, building: /housing|condominio/,
  droplet: /water|saneamento|sabesp|cedae|copasa/, bank: /financing|financiamento|prestacao hab/,
};
const docOf = (p) => (p?.documentNumber?.value || '').replace(/\D/g, '');
const isPix = (tx) => /PIX/i.test(tx.operationType || '') || /PIX/i.test(tx.paymentData?.paymentMethod || '') || /\bpix\b/.test(norm(tx.description));
const isBoleto = (tx) => /BOLETO|CONVENIO|ARRECADA/i.test(tx.operationType || '') || /BOLETO/i.test(tx.paymentData?.paymentMethod || '') || /boleto|debito autom|deb autom|convenio|arrecada/.test(norm(tx.description));

// ---------- armazenamento ----------
export function setupPluggy({ dataDir, readState, mutateState, log = console.log, envFile = path.join(dataDir, '..', '.env'), clientUserId = 'solo-finn' }) {
  const FILE = path.join(dataDir, 'pluggy.json');
  const load = () => {
    try { return { items: [], known: {}, ...JSON.parse(fs.readFileSync(FILE, 'utf8')) }; } catch { return { items: [], known: {} }; }
  };
  const save = (db) => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(db, null, 1)); fs.renameSync(FILE + '.tmp', FILE); };

  // relê o .env se as credenciais ainda não estiverem carregadas (permite colar o secret sem reiniciar)
  const configured = () => {
    if (!(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET)) {
      try { const env = parseEnv(fs.readFileSync(envFile, 'utf8')); for (const k of Object.keys(env)) if (k.startsWith('PLUGGY_') && env[k]) process.env[k] = env[k]; } catch {}
    }
    return !!(process.env.PLUGGY_CLIENT_ID && process.env.PLUGGY_CLIENT_SECRET);
  };
  let client = null;
  const api = () => {
    if (!configured()) throw new Error('Credenciais da Pluggy não configuradas (.env)');
    if (!client) client = new PluggyClient({ clientId: process.env.PLUGGY_CLIENT_ID, clientSecret: process.env.PLUGGY_CLIENT_SECRET });
    return client;
  };

  // ---------- busca na Pluggy ----------
  async function fetchAll(db) {
    const c = api();
    const out = [];
    for (const it of db.items) {
      const entry = { item: it, accounts: [], error: null };
      try {
        const item = await c.fetchItem(it.id);
        Object.assign(it, {
          name: item.connector?.name || it.name, connectorId: item.connector?.id, imageUrl: item.connector?.imageUrl,
          status: item.status, executionStatus: item.executionStatus, lastUpdatedAt: item.lastUpdatedAt,
        });
        const since = db.lastSync ? addDays(db.lastSync.slice(0, 10), -OVERLAP_DAYS) : addDays(todayYmd(), -FIRST_SYNC_DAYS);
        const accounts = (await c.fetchAccounts(it.id)).results || [];
        it.institution = institutionName(accounts) || it.institution;
        for (const acc of accounts) {
          const txs = await c.fetchAllTransactions(acc.id, { dateFrom: since });
          entry.accounts.push({ acc, txs });
        }
      } catch (e) {
        entry.error = e?.message || String(e);
        log(`[pluggy] erro no item ${it.name || it.id}: ${entry.error}`);
      }
      out.push(entry);
    }
    return out;
  }

  // ---------- aplicação no estado do app ----------
  // Regras (validadas com os dados reais do Nubank/CAIXA/Santander):
  // - cartão: gasto = valor positivo; estorno/pagamento = negativo. Compras da fatura aberta chegam PENDING e
  //   todas as parcelas (inclusive futuras) vêm como transações separadas com creditCardMetadata.
  // - compras em moeda estrangeira: usa amountInAccountCurrency (BRL).
  function apply(s, data, db, report) {
    s.cards = s.cards || []; s.purchases = s.purchases || []; s.transactions = s.transactions || [];
    s.payments = s.payments || {}; s.overrides = s.overrides || {};
    const known = db.known;
    const startM = s.trackingStart || todayYmd().slice(0, 7);
    const start = `${startM}-01`;
    const ownDocs = new Set(data.flatMap((e) => e.accounts.map((a) => (a.acc.taxNumber || '').replace(/\D/g, ''))).filter(Boolean));
    const add = (k) => { report[k] = (report[k] || 0) + 1; };
    const mark = (id, why) => { known[id] = why; };
    const brlOf = (tx) => round2(Math.abs(tx.amountInAccountCurrency ?? tx.amount));
    const setPaid = (M, id) => { s.payments[M] = s.payments[M] || {}; s.payments[M][id] = true; };

    for (const { item, accounts } of data) {
      for (const { acc, txs } of accounts) {
        const bank = bankKey(`${acc.name} ${acc.marketingName || ''} ${item.institution || ''}`);
        if (acc.type === 'CREDIT') {
          // ---- cartão ----
          let card = s.cards.find((c) => c.pluggyAccountId === acc.id);
          const cd = acc.creditData || {};
          if (!card) {
            const same = s.cards.filter((c) => !c.pluggyAccountId && c.bank === bank);
            if (same.length === 1) card = same[0];
          }
          if (!card && !txs.length) continue; // cartão sem movimento: não polui o app
          if (!card) {
            card = {
              id: uid(), name: acc.marketingName || titleCase(acc.name) || `Cartão ${item.institution || ''}`.trim(), bank, product: cd.level || undefined,
              limit: cd.creditLimit || 0, closingDay: cd.balanceCloseDate ? Number(ymd(cd.balanceCloseDate).slice(8)) : 1,
              dueDay: cd.balanceDueDate ? Number(ymd(cd.balanceDueDate).slice(8)) : 10,
            };
            s.cards.push(card);
            add('cardsCreated');
          }
          card.pluggyAccountId = acc.id;
          if (cd.creditLimit && cd.creditLimit > 1) card.limit = cd.creditLimit;
          if (cd.availableCreditLimit != null) card.available = cd.availableCreditLimit;
          card.syncedAt = new Date().toISOString();

          // IOF cobrado e devolvido no mesmo valor ("IOF de volta de …"): ignora o par
          const credits = txs.filter((t) => t.amount < 0 && !/PAGAMENTO_FATURA/i.test(t.operationType || '') && !/pagamento|pgto|pagto/.test(norm(t.description)));
          const cancelled = new Set();
          for (const t of txs) {
            if (t.amount <= 0 || !/^iof/.test(norm(t.description))) continue;
            const c = credits.find((c) => !cancelled.has(c.id) && Math.abs(brlOf(c) - brlOf(t)) < 0.01 && daysApart(ymd(c.date), ymd(t.date)) <= 5);
            if (c) { cancelled.add(c.id); cancelled.add(t.id); }
          }
          const dueOk = (pdate, n) => addMonthsKey(purchaseDueMonth(card, pdate), n - 1) >= startM;

          for (const tx of txs) {
            if (known[tx.id]) continue;
            const pending = tx.status === 'PENDING';
            const desc = cleanDesc(tx.merchant?.name || tx.description);
            const meta = tx.creditCardMetadata || {};
            const value = brlOf(tx);
            if (!value) { mark(tx.id, 'zero'); continue; }
            const d = norm(tx.description);
            if (cancelled.has(tx.id)) { mark(tx.id, 'iof'); add('skipped'); continue; }
            if (tx.amount < 0) {
              if (/PAGAMENTO_FATURA/i.test(tx.operationType || '') || /pagamento|pgto|pagto/.test(d)) { mark(tx.id, 'pagamento-fatura'); add('skipped'); continue; }
              const date = ymd(tx.date);
              if (!dueOk(date, 1)) { mark(tx.id, 'antigo'); continue; }
              // estorno: entra como valor negativo na fatura
              const prev = s.purchases.find((x) => x.pluggyPending && x.cardId === card.id && x.amount === -value && daysApart(x.date, date) <= 3);
              if (prev) { prev.pluggyId = tx.id; prev.pluggyPending = pending || undefined; mark(tx.id, 'estorno'); continue; }
              s.purchases.push({ id: uid(), cardId: card.id, desc: /^estorno/i.test(desc) ? desc : `Estorno — ${desc}`, date, amount: -value, installments: 1, category: 'Outros', src: 'pluggy', pluggyId: tx.id, pluggyPending: pending || undefined, review: true });
              mark(tx.id, 'estorno'); add('purchases');
              continue;
            }
            const n = Number(meta.totalInstallments) || 1;
            const pdate = ymd(meta.purchaseDate) || ymd(tx.date);
            const category = toCategory(tx, desc);
            if (n > 1) {
              const key = `${acc.id}|${pdate}|${n}|${norm(desc)}`;
              let p = s.purchases.find((x) => x.pluggyKey === key);
              if (!p) p = s.purchases.find((x) => x.cardId === card.id && !x.recurring && (x.installments || 1) === n && !x.pluggyKey &&
                daysApart(x.date, pdate) <= 45 && (Math.abs((x.installmentValue ?? x.amount / n) - value) <= 0.06 || Math.abs((x.firstInstallment ?? -1) - value) <= 0.06));
              if (p) { if (!p.pluggyKey) { p.pluggyKey = key; add('linked'); } mark(tx.id, 'parcela'); continue; }
              if (!dueOk(pdate, n)) { mark(tx.id, 'antigo'); continue; }
              // parcelas da mesma compra chegam separadas: cria uma compra só, com o total
              const total = round2(meta.totalAmount && meta.totalAmount > value ? meta.totalAmount : value * n);
              s.purchases.push({ id: uid(), cardId: card.id, desc, date: pdate, amount: total, installments: n, installmentValue: value, category, src: 'pluggy', pluggyKey: key, review: true });
              mark(tx.id, 'parcela'); add('purchases');
              continue;
            }
            const M = pdate.slice(0, 7);
            // compra já lançada à mão, ou pendente que agora foi lançada (a Pluggy troca o id): reaproveita
            const one = s.purchases.find((x) => x.cardId === card.id && !x.recurring && (x.installments || 1) === 1 && (!x.pluggyId || x.pluggyPending) &&
              daysApart(x.date, pdate) <= 2 && Math.abs(x.amount - value) < 0.01);
            if (one) { if (!one.pluggyId) add('linked'); one.pluggyId = tx.id; one.pluggyPending = pending || undefined; mark(tx.id, 'compra'); continue; }
            // assinatura já cadastrada como recorrente
            const rec = s.purchases.find((x) => x.cardId === card.id && x.recurring && (!x.endMonth || x.endMonth >= M) &&
              Math.abs(x.amount - value) <= Math.max(1, x.amount * 0.15) && similar(x.desc, desc));
            if (rec) { mark(tx.id, 'assinatura'); add('linked'); continue; }
            if (!dueOk(pdate, 1)) { mark(tx.id, 'antigo'); continue; }
            s.purchases.push({ id: uid(), cardId: card.id, desc, date: pdate, amount: value, installments: 1, category, src: 'pluggy', pluggyId: tx.id, pluggyPending: pending || undefined, review: true });
            mark(tx.id, 'compra'); add('purchases');
          }
          continue;
        }

        // ---- conta corrente / poupança ----
        for (const tx of txs) {
          if (known[tx.id]) continue;
          const date = ymd(tx.date);
          if (date < start) continue; // antes do início do acompanhamento no app
          const pending = tx.status === 'PENDING';
          const out = tx.type ? tx.type === 'DEBIT' : tx.amount < 0;
          const value = brlOf(tx);
          if (!value) { mark(tx.id, 'zero'); continue; }
          const pd = tx.paymentData || {};
          const other = out ? pd.receiver : pd.payer;
          const otherName = titleCase(other?.name || (tx.description || '').split('|')[1] || '');
          const M = date.slice(0, 7);

          if (isInvestment(tx)) { mark(tx.id, 'investimento'); add('skipped'); continue; }
          if ((other && ownDocs.has(docOf(other))) || /same person/i.test(tx.category || '') || /MESMA_TITULARIDADE/i.test(tx.operationType || '') ||
            /mesma titularidade|entre contas|transf.* propria/.test(norm(tx.description))) { mark(tx.id, 'entre-contas'); add('skipped'); continue; }

          if (out && isCardBillPayment(tx)) {
            // marca como paga a fatura do mês com o mesmo valor
            const c = s.cards.find((c) => Math.abs(invoiceTotal(s, c, M) - value) <= Math.max(1, value * 0.02));
            if (c && !isPaid(s, M, `card:${c.id}`)) { setPaid(M, `card:${c.id}`); add('billsPaid'); }
            mark(tx.id, 'pagamento-fatura'); add('skipped'); continue;
          }
          if (!out && (isSalary(tx) || salaryParts(s, M).some((p) => Math.abs(p.amount - value) <= Math.max(1, p.amount * 0.01)))) {
            mark(tx.id, 'salario'); add('skipped'); continue;
          }

          if (out) {
            // conta fixa paga (boleto, débito automático, convênio ou Pix com o mesmo valor perto do vencimento)
            const day = Number(date.slice(8));
            const cands = billsForMonth(s, M).filter((b) => iPay(b)).map((b) => {
              const diff = Math.abs(b.amount - value);
              const okAmount = b.estimated ? diff <= Math.max(3, b.amount * 0.25) : diff <= Math.max(0.5, b.amount * 0.02);
              const dd = Math.min(Math.abs(b.dueDay - day), 31 - Math.abs(b.dueDay - day));
              const hint = BILL_HINTS[b.icon];
              const nameHit = similar(b.name, `${tx.description} ${otherName}`) || (hint ? hint.test(norm(`${tx.category} ${otherName}`)) : false);
              const ok = okAmount && dd <= 10 && (isBoleto(tx) || nameHit || diff <= 0.01);
              const paid = isPaid(s, M, b.id);
              return { b, ok, paid, score: diff / Math.max(1, b.amount) + dd / 31 - (nameHit ? 1 : 0) + (paid ? 0.5 : 0) };
            }).filter((x) => x.ok).sort((a, b) => a.score - b.score);
            if (cands[0]) {
              const { b, paid } = cands[0];
              if (!paid) { setPaid(M, b.id); add('billsPaid'); } else add('linked');
              if (b.estimated && !s.overrides[M]?.[b.id]) { s.overrides[M] = s.overrides[M] || {}; s.overrides[M][b.id] = value; }
              mark(tx.id, `conta:${b.id}`); continue;
            }
          } else {
            // dinheiro recebido que bate com algo "a receber" do mês (reembolso de alguém)
            const rs = receivables(s, M);
            const r = rs.filter((r) => !r.received && Math.abs(r.amount - value) <= Math.max(1, r.amount * 0.01))
              .sort((a, b) => Math.abs(a.amount - value) - Math.abs(b.amount - value))[0];
            if (r) { setPaid(M, `recv:${r.key}:${r.personId}`); mark(tx.id, `reembolso:${r.personId}`); add('reimbursed'); continue; }
            const done = rs.find((r) => r.received && Math.abs(r.amount - value) <= Math.max(1, r.amount * 0.01)); // já marcado como recebido à mão
            if (done) { mark(tx.id, `reembolso:${done.personId}`); add('linked'); continue; }
          }

          // lançamento avulso (Pix, débito, boleto não reconhecido, receita)
          const desc = isPix(tx) ? (otherName ? `Pix — ${otherName}` : out ? 'Pix enviado' : 'Pix recebido') : cleanDesc(otherName || tx.merchant?.name || (tx.description || '').split('|')[0]);
          const type = out ? 'out' : 'in';
          const dup = s.transactions.find((t) => (!t.pluggyId || t.pluggyPending) && t.type === type && daysApart(t.date, date) <= 1 && Math.abs(t.amount - value) < 0.01);
          if (dup) { if (!dup.pluggyId) add('linked'); dup.pluggyId = tx.id; dup.pluggyPending = pending || undefined; mark(tx.id, 'lancamento'); continue; }
          // Pix recebido de alguém que já te devolveu dinheiro antes (nome lembrado no app): já vem marcado como devolução
          const reimbFrom = !out && otherName ? (s.people || []).find((p) => (p.pixNames || []).includes(otherName))?.id : undefined;
          s.transactions.push({ id: uid(), date, desc, amount: value, type, category: out ? toCategory(tx, desc) : 'Outros', src: 'pluggy', pluggyId: tx.id, pluggyPending: pending || undefined, bank, reimbFrom, review: true });
          mark(tx.id, 'lancamento'); add('transactions');
        }
      }
    }
  }

  // ---------- sincronização ----------
  let running = null;
  async function sync(reason = 'manual') {
    if (running) return running;
    running = (async () => {
      const db = load();
      const startedAt = new Date().toISOString();
      if (!configured()) return { ok: false, error: 'Credenciais da Pluggy não configuradas' };
      if (!db.items.length) return { ok: false, error: 'Nenhum banco conectado' };
      try {
        const data = await fetchAll(db);
        const report = { purchases: 0, transactions: 0, linked: 0, billsPaid: 0, skipped: 0, cardsCreated: 0 };
        const errors = data.filter((e) => e.error).map((e) => `${e.item.name || e.item.id}: ${e.error}`);
        mutateState((s) => apply(s, data.filter((e) => !e.error), db, report));
        db.lastSync = startedAt;
        db.lastResult = { ok: !errors.length, at: new Date().toISOString(), reason, ...report, errors };
        save(db);
        log(`[pluggy] sync (${reason}): ${JSON.stringify(db.lastResult)}`);
        return db.lastResult;
      } catch (e) {
        db.lastResult = { ok: false, at: new Date().toISOString(), reason, error: e?.message || String(e) };
        save(db);
        log(`[pluggy] falha na sync: ${db.lastResult.error}`);
        return db.lastResult;
      }
    })();
    try { return await running; } finally { running = null; }
  }

  // ---------- agendamento diário ----------
  const nextRun = () => {
    const n = new Date(); const t = new Date(n); t.setHours(SYNC_HOUR, 0, 0, 0);
    if (t <= n) t.setDate(t.getDate() + 1);
    return t;
  };
  let timer = null; let nextAt = null;
  const schedule = () => {
    clearTimeout(timer);
    nextAt = nextRun();
    timer = setTimeout(async () => { if (load().lastSync) await sync('agendada'); schedule(); }, nextAt - Date.now());
  };
  schedule();
  // computador estava desligado no horário: recupera a sincronização do dia
  setTimeout(() => {
    const db = load();
    const today = new Date(); today.setHours(SYNC_HOUR, 0, 0, 0);
    // só recupera se já houve uma primeira sincronização (a primeira é sempre feita à mão, em "Sincronizar agora")
    if (configured() && db.items.length && db.lastSync && new Date() > today && new Date(db.lastSync) < today) sync('recuperação');
  }, 15000);

  // ---------- rotas ----------
  const json = (res, code, obj) => { res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
  const body = (req) => new Promise((ok) => { let b = ''; req.on('data', (c) => { b += c; if (b.length > 1e5) req.destroy(); }); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch { ok({}); } }); });

  async function handle(req, res, url) {
    const p = url.pathname.replace(/^\/api\/pluggy/, '');
    try {
      if (p === '/status' && req.method === 'GET') {
        const db = load();
        return json(res, 200, { configured: configured(), syncHour: SYNC_HOUR, items: db.items, lastSync: db.lastSync || null, lastResult: db.lastResult || null, nextRun: nextAt, running: !!running });
      }
      if (p === '/connect-token' && req.method === 'POST') {
        const { itemId } = await body(req);
        const t = await api().createConnectToken(itemId || undefined, { clientUserId });
        const ids = (process.env.PLUGGY_CONNECTOR_IDS || '').split(',').map(Number).filter(Boolean);
        return json(res, 200, { accessToken: t.accessToken, connectorIds: ids.length ? ids : undefined });
      }
      if (p === '/items' && req.method === 'POST') {
        const { itemId } = await body(req);
        if (!itemId) return json(res, 400, { error: 'itemId obrigatório' });
        const item = await api().fetchItem(itemId);
        let institution = null;
        try { institution = institutionName((await api().fetchAccounts(itemId)).results || []); } catch {}
        const db = load();
        const row = { id: item.id, name: item.connector?.name, connectorId: item.connector?.id, imageUrl: item.connector?.imageUrl, institution, status: item.status, addedAt: new Date().toISOString() };
        db.items = [...db.items.filter((i) => i.id !== item.id), row];
        save(db);
        return json(res, 200, row);
      }
      const del = p.match(/^\/items\/([\w-]+)$/);
      if (del && req.method === 'DELETE') {
        const db = load();
        db.items = db.items.filter((i) => i.id !== del[1]);
        save(db);
        return json(res, 200, { ok: true });
      }
      if (p === '/sync' && req.method === 'POST') return json(res, 200, await sync('manual'));
      return json(res, 404, { error: 'not found' });
    } catch (e) {
      log(`[pluggy] ${p}: ${e?.message || e}`);
      return json(res, 500, { error: e?.message || String(e) });
    }
  }

  // simulação: busca e aplica numa cópia, sem gravar nada (para conferir antes)
  async function preview() {
    const db = structuredClone(load());
    const before = readState();
    const s = structuredClone(before);
    const data = await fetchAll(db);
    const report = { purchases: 0, transactions: 0, linked: 0, billsPaid: 0, reimbursed: 0, skipped: 0, cardsCreated: 0 };
    apply(s, data.filter((e) => !e.error), db, report);
    const ids = (arr) => new Set((arr || []).map((x) => x.id));
    const oldP = ids(before.purchases); const oldT = ids(before.transactions);
    const paid = [];
    for (const M of Object.keys(s.payments)) for (const k of Object.keys(s.payments[M])) if (!before.payments?.[M]?.[k]) paid.push(`${M} ${k}`);
    return {
      report, errors: data.filter((e) => e.error).map((e) => e.error), known: db.known,
      newPurchases: s.purchases.filter((p) => !oldP.has(p.id)), newTransactions: s.transactions.filter((t) => !oldT.has(t.id)),
      linkedPurchases: s.purchases.filter((p) => oldP.has(p.id) && (p.pluggyId || p.pluggyKey)).map((p) => `${p.date} ${p.desc} ${p.amount}`),
      paid, overrides: s.overrides, cards: s.cards.map(({ id, name, bank, limit, available, pluggyAccountId }) => ({ id, name, bank, limit, available, linked: !!pluggyAccountId })),
    };
  }

  const stop = () => clearTimeout(timer);
  return { handle, sync, preview, stop };
}
