// Gerencia os logins do Caderninho.
//   npm run usuario -- criar <usuario> "<Nome>"   cria um login (pede a senha)
//   npm run usuario -- senha <usuario>            troca a senha (encerra as sessões abertas)
//   npm run usuario -- listar                     mostra quem tem login
//   npm run usuario -- remover <usuario>          tira o login (os dados ficam em data/users/<id>)
// O primeiro usuário criado herda os dados da versão de uma pessoa só (data/state.json e data/pluggy.json), se existirem.
import path from 'node:path';
import fs from 'node:fs';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';
import { createAuth, migrateLegacy } from '../auth.js';

const DATA_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });
const auth = createAuth(DATA_DIR);

// pergunta a senha sem mostrar o que é digitado
function askHidden(question) {
  return new Promise((resolve) => {
    if (!process.stdin.isTTY) {
      const rl = readline.createInterface({ input: process.stdin });
      rl.once('line', (l) => { rl.close(); resolve(l); });
      return;
    }
    process.stdout.write(question);
    let s = '';
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.setEncoding('utf8');
    const onData = (ch) => {
      if (ch === '\r' || ch === '\n' || ch === '\u0004') {
        process.stdin.setRawMode(false); process.stdin.pause(); process.stdin.off('data', onData);
        process.stdout.write('\n'); resolve(s);
      } else if (ch === '\u0003') { process.stdout.write('\n'); process.exit(1); }
      else if (ch === '\u007f' || ch === '\b') s = s.slice(0, -1);
      else s += ch;
    };
    process.stdin.on('data', onData);
  });
}
async function newPassword() {
  const a = await askHidden(`Senha (mínimo ${auth.MIN_PASSWORD} caracteres): `);
  if (!process.stdin.isTTY) return a;
  const b = await askHidden('Repita a senha: ');
  if (a !== b) throw new Error('As senhas não conferem');
  return a;
}

const [cmd, login, name] = process.argv.slice(2);
try {
  if (cmd === 'criar' && login) {
    const first = auth.listUsers().length === 0;
    const u = auth.addUser(login, name || login, await newPassword());
    console.log(`Login "${u.login}" criado para ${u.name}.`);
    if (first) {
      const moved = migrateLegacy(DATA_DIR, u.id, auth);
      if (moved.length) console.log(`Seus dados antigos (${moved.join(', ')}) agora são de ${u.name}.`);
    }
    console.log('Reinicie o servidor (npm start) se ele estiver rodando, para ligar a sincronização diária desse login.');
  } else if (cmd === 'senha' && login) {
    const u = auth.setPassword(login, await newPassword());
    console.log(`Senha de "${u.login}" trocada. As sessões abertas foram encerradas.`);
  } else if (cmd === 'listar') {
    const users = auth.listUsers();
    if (!users.length) console.log('Nenhum usuário ainda.');
    for (const u of users) console.log(`${u.login}\t${u.name}\tdados em data/users/${u.id}`);
  } else if (cmd === 'remover' && login) {
    const u = auth.removeUser(login);
    console.log(`Login "${u.login}" removido. Os dados continuam em data/users/${u.id} (apague à mão se quiser).`);
  } else {
    console.log('Uso:\n  npm run usuario -- criar <usuario> "<Nome>"\n  npm run usuario -- senha <usuario>\n  npm run usuario -- listar\n  npm run usuario -- remover <usuario>');
    process.exitCode = cmd ? 1 : 0;
  }
} catch (e) {
  console.error(`Erro: ${e.message}`);
  process.exitCode = 1;
}
