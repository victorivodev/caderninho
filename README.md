<p align="center"><img src="public/app-icon-192.png" width="96" alt="" /></p>

# Caderninho

O velho caderninho de contas, em versão app, rodando no seu próprio computador. Esta versão é para **o casal**: cada pessoa tem o próprio login, os próprios lançamentos e os próprios bancos conectados, e a tela **Nós dois** junta os totais do mês dos dois. Os dados ficam em arquivos locais (`data/`): não tem nuvem nem servidor de terceiros.

> Fork de [natancardosoo/caderninho](https://github.com/natancardosoo/caderninho), que é a versão para uma pessoa só.

## O que ele faz

- **Login para cada pessoa:** cada um vê só os próprios lançamentos, cartões e bancos.
- **Nós dois:** renda, contas da casa, contas pessoais, dia a dia e quanto sobra de cada um no mês, lado a lado, e o total do casal.
- **Visão geral do mês:** renda, contas da casa, contas pessoais, faturas e quanto sobra.
- **Fluxo de caixa:** tudo que entra e sai, dia a dia, com marcação de pago/recebido.
- **Cartões:** compras parceladas, assinaturas e a fatura de cada mês (com fechamento e vencimento).
- **Contas fixas:** aluguel, luz, internet etc., com valor estimado e ajuste mês a mês.
- **Quem paga?:** divida contas, compras e Pix com outras pessoas. O app calcula o que cada uma te deve, mês a mês ou como saldo sem prazo (ex.: um empréstimo ou uma obra). Cada fatura mostra quanto cada pessoa deve nela, com um resumo pronto para mandar.
- **Reserva, renda e financiamento da casa.**
- **Bancos conectados (opcional):** importação automática via Open Finance com a [Pluggy](https://pluggy.ai) (Meu Pluggy). O que chega cai na tela **Para revisar**, no menu, onde você confirma categoria e quem paga com um toque.

Funciona no navegador e pode ser instalado como app (PWA) no celular.

## Como rodar

Precisa do [Node.js](https://nodejs.org) 20.12 ou mais novo (recomendado 22+).

Clone o repositório (ou faça um fork e clone o seu, para guardar suas próprias mudanças):

```bash
git clone https://github.com/victorivodev/caderninho.git
cd caderninho
npm install
npm run build
npm run usuario -- criar victor "Victor"      # pede a senha
npm run usuario -- criar esposa "Nome dela"  # um login para cada pessoa
npm start
```

Abra http://127.0.0.1:4320 (para usar outra porta: `PORT=4400 npm start`) e entre com seu usuário. Na primeira vez cada pessoa vê **dados de exemplo** para explorar; em **Minha renda** há a opção de apagar o exemplo e começar do zero.

### Logins

```bash
npm run usuario -- criar <usuario> "<Nome>"   # cria um login
npm run usuario -- senha <usuario>            # troca a senha (encerra as sessões abertas)
npm run usuario -- listar
npm run usuario -- remover <usuario>          # os dados continuam em data/users/<id>
```

Cada pessoa também troca a própria senha no app, no ícone de chave ao lado do nome. Se você já usava a versão de uma pessoa só, o **primeiro** login criado fica com os dados antigos (`data/state.json` e `data/pluggy.json`).

Na tela **Nós dois**, as contas da casa entram com a parte de cada um. Para não contar errado, cadastre uma conta dividida nos dois logins, cada um com a própria parte, ou em um login só com 100%.

Para desenvolver com recarregamento automático, deixe `npm start` rodando e, em outro terminal, rode `npm run dev` (o Vite repassa `/api` para o servidor).

### Acessar pelo celular

O servidor só escuta em `127.0.0.1` de propósito. Agora o app tem login, mas o jeito mais seguro de usar no celular continua sendo expor a porta só para os aparelhos de vocês, por exemplo com o [Tailscale](https://tailscale.com) (instale nos celulares dos dois):

```bash
tailscale serve --bg --https=10000 http://127.0.0.1:4320
```

Não exponha o app na internet aberta. Se precisar escutar em outro endereço, use `HOST=0.0.0.0 npm start` por sua conta e risco.

### Iniciar com o Windows

`start-hidden.vbs` inicia o servidor sem abrir janela. Crie um atalho dele na pasta que abre com `Win + R` → `shell:startup`.

## Conectar bancos (opcional)

1. Crie uma conta em [dashboard.pluggy.ai](https://dashboard.pluggy.ai) e uma aplicação para pegar o **Client ID** e o **Client Secret**.
2. Copie `.env.example` para `.env` e preencha as duas credenciais.
3. Cada pessoa cria a própria conta no [Meu Pluggy](https://meu.pluggy.ai) e autoriza lá os próprios bancos.
4. Entrando com o próprio login, cada um vai em **Bancos conectados → Conectar banco**, escolhe **Meu Pluggy** e entra com a conta dele. As conexões de um não aparecem para o outro.
5. Toque em **Sincronizar agora**. A partir daí o app sincroniza sozinho todo dia no horário de `PLUGGY_SYNC_HOUR` (padrão 18h).

O que chega dos bancos cai em **Para revisar**: confira a categoria e quem paga antes de confirmar. Compras parceladas, pagamentos de fatura, contas fixas e reembolsos são reconhecidos automaticamente quando possível.

## Seus dados

Tudo fica na pasta `data/` (ignorada pelo git):

- `users.json`: os logins (a senha fica guardada só como hash).
- `sessions.json`: as sessões abertas.
- `users/<id>/state.json`: os lançamentos de cada pessoa. O servidor guarda a versão anterior em `state.json.bak` a cada gravação.
- `users/<id>/pluggy.json`: as conexões com os bancos de cada pessoa e o controle do que já foi importado.

Para fazer backup, copie a pasta `data/`. Nunca publique `data/` nem `.env`.

## Licença

[MIT](LICENSE). Os ícones 3D em `public/icons` são do [Fluent Emoji](https://github.com/microsoft/fluentui-emoji), da Microsoft (MIT).
