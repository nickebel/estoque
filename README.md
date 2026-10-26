# Estoque da Padaria

Aplicação web simples para cadastrar produtos, acompanhar saldo e gerar relatórios PDF.

## Funcionalidades

- Cadastro manual de produtos, categorias, unidade de controle, quantidade atual, limite mínimo e observações.
- Unidades flexíveis: caixas, fardos, pacotes, sacos, kg, litros e qualquer unidade digitada pela equipe.
- Entradas e saídas com atualização automática do saldo; bloqueia saídas acima do estoque disponível.
- Busca rápida por nome, categoria e observação.
- PDF de consulta individual, estoque completo e histórico de movimentações.
- Compartilhamento do PDF quando o navegador/dispositivo oferece suporte; nos demais casos o arquivo é baixado para envio manual.
- Exportação de backup JSON; a restauração é compatível com o modo local. No banco compartilhado, a importação ainda está desativada.
- Layout adaptado para computador e celular.

## Publicar com GitHub Pages

1. No repositório **nickebel/estoque**, entre em **Settings → Pages**.
2. Em **Build and deployment**, selecione **Deploy from a branch**.
3. Escolha a branch **main** e a pasta **/(root)** e salve.
4. Aguarde a publicação. O endereço do site será exibido nas configurações do Pages, normalmente `https://nickebel.github.io/estoque/`.

O arquivo de entrada é `index.html`; não é necessário instalar dependências ou compilar o projeto.

## Preparar o banco compartilhado (Cloudflare D1)

O projeto já inclui uma API para o Cloudflare Workers e um esquema SQL para D1:

- API: [`cloudflare/worker.js`](./cloudflare/worker.js)
- Tabelas: [`cloudflare/schema.sql`](./cloudflare/schema.sql)
- Configuração: [`wrangler.jsonc`](./wrangler.jsonc)
- Endereço da API que o site usará: [`api-config.js`](./api-config.js)

### 1. Criar o banco D1

1. Crie uma conta no [Cloudflare Dashboard](https://dash.cloudflare.com/).
2. Abra **Storage & databases → D1 SQL Database** e escolha **Create database**.
3. Nome sugerido: `estoque-padaria`.
4. Abra a base criada e use o editor SQL para executar todo o conteúdo de [`cloudflare/schema.sql`](./cloudflare/schema.sql).

### 2. Configurar o Worker

1. Copie o **Database ID** exibido na página D1.
2. No repositório, abra [`wrangler.jsonc`](./wrangler.jsonc) e substitua `SUBSTITUA_PELO_ID_DO_BANCO_D1` pelo ID real. Salve a alteração.
3. No Cloudflare, abra **Workers & Pages → Create application**, conecte ao GitHub e selecione `nickebel/estoque`. Use a configuração Wrangler existente para publicar o Worker.
4. Confirme que a configuração de build usa a raiz do repositório e que o comando de deploy é `npx wrangler deploy` (o `package.json` já inclui Wrangler). Na página do Worker, abra **Settings → Variables and Secrets** e adicione dois **secrets**:
   - `APP_PASSWORD`: uma senha forte que a equipe usará para entrar no aplicativo.
   - `SESSION_SECRET`: uma chave aleatória longa e diferente, usada para assinar as sessões.
5. Salve os secrets e publique/reimplante o Worker se o painel pedir.

Não coloque esses dois valores em arquivos do GitHub nem os envie pelo chat. Esta primeira versão usa **uma senha compartilhada pela equipe**; contas individuais de funcionários podem ser adicionadas em uma próxima etapa.

### 3. Ligar o site à API

1. Depois de publicar, copie o endereço HTTPS do Worker, geralmente terminado em `.workers.dev`.
2. Abra [`api-config.js`](./api-config.js) e coloque o endereço em `apiBaseUrl`, sem barra no final. Exemplo de formato: `https://nome-do-worker.sua-conta.workers.dev`.
3. Salve o arquivo no GitHub e aguarde o GitHub Pages atualizar o site.
4. Abra o app, entre com a senha definida em `APP_PASSWORD` e cadastre um produto de teste. Abra o app em outro dispositivo e entre com a mesma senha: o produto deverá aparecer nos dois.

O Worker só aceita chamadas do site `https://nickebel.github.io` e dos endereços locais de desenvolvimento listados em `cloudflare/worker.js`. Se usar um domínio personalizado depois, será necessário adicionar a origem permitida.

### Avisos

- Os dados passam a vir do banco online quando `api-config.js` contém o endereço do Worker. Enquanto ele estiver vazio, o aplicativo continua no modo local de navegador.
- A versão atual permite entrar com uma senha comum da equipe. O token de sessão expira após 12 horas.
- A lista de produtos e o histórico são recarregados após alterações, ao retornar à janela e automaticamente a cada 60 segundos enquanto o app está aberto. Também há o botão **Atualizar** e o botão **Sair** no cabeçalho.
- O backup JSON pode ser exportado; a restauração direta de um backup no banco compartilhado ainda está desativada para evitar substituir os dados de toda a equipe acidentalmente.
- O plano gratuito tem limites e, ao exceder cotas, a API pode parar temporariamente. Acompanhe o consumo no painel Cloudflare.

## Instalar no celular como aplicativo

Depois de ativar o GitHub Pages e o site estar disponível por HTTPS:

- **Android (Chrome):** abra o site e toque em **Instalar app** quando o botão aparecer. Também pode abrir o menu ⋮ do navegador e escolher **Instalar app** ou **Adicionar à tela inicial**.
- **iPhone/iPad (Safari):** abra o site, toque em **Compartilhar** e escolha **Adicionar à Tela de Início**.
- **Computador:** em navegadores compatíveis, use o ícone de instalação na barra de endereço ou o menu do navegador.

O app tem manifesto, ícones e service worker para permitir instalação e carregar a interface básica quando estiver sem internet, depois da primeira abertura online. A geração de PDF utiliza uma biblioteca externa e pode precisar de conexão.

## Como usar

1. Acesse a página do app e abra **Produtos**.
2. Cadastre cada produto e escolha uma unidade de controle. Exemplo: farinha, unidade “fardos”, quantidade 4.
3. Em **Movimentações**, registre novas entradas e saídas. O saldo será atualizado automaticamente.
4. Na página inicial, pesquise um produto para ver a quantidade e gerar um PDF.
5. Em **Relatórios e backup**, gere o PDF completo ou exporte um backup JSON.

Para itens que vêm em caixas ou fardos com embalagens internas, mantenha uma unidade de controle consistente e use a observação para registrar detalhes, por exemplo: “caixa com 12 pacotes”.

## Limitações importantes

- Com `api-config.js` configurado, produtos e movimentações são compartilhados entre aparelhos pelo Cloudflare D1. Sem a configuração da API, o app trabalha em modo local e os dados não sincronizam.
- Faça backups regularmente em **Relatórios e backup**.
- O gerador de PDF usa jsPDF por CDN, então precisa de conexão com a internet. Se a biblioteca não carregar, tente novamente com internet.
- O botão de compartilhar usa o menu de compartilhamento do próprio dispositivo quando disponível. Caso contrário, baixa o PDF para você anexá-lo manualmente no WhatsApp ou em outro aplicativo.
- O acesso online usa inicialmente uma senha compartilhada pela equipe. Guarde a senha e os secrets do Worker com cuidado; não os publique no repositório.

## Dados e privacidade

Os dados do estoque são mantidos no navegador por meio de `localStorage`. Não cadastre informações pessoais desnecessárias. Antes de limpar os dados do navegador, exporte um backup.
