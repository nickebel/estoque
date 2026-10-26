# Capricho — Gestão de Estoque

Sistema de gestão de estoque da Panificação Capricho para computador e celular, com cadastro de produtos, controle de entradas e saídas, alertas de estoque baixo e relatórios em PDF.

## Funcionalidades

- Cadastro manual de produtos, categorias, unidade de controle, quantidade atual, limite mínimo e observações.
- Unidades flexíveis: caixas, fardos, pacotes, sacos, kg, litros e qualquer unidade digitada pela equipe.
- Entradas e saídas com atualização automática do saldo; bloqueia saídas acima do estoque disponível.
- Busca rápida por nome, categoria e observação.
- PDF de consulta individual, estoque completo e histórico de movimentações.
- Compartilhamento do PDF quando o navegador/dispositivo oferece suporte; nos demais casos o arquivo é baixado para envio manual.
- Exportação de backup JSON; a restauração é compatível com o modo local. No banco compartilhado, a importação ainda está desativada.
- Trilha de auditoria de cadastros, ajustes, exclusões e movimentações (requer a migração D1 0002 no banco já existente).
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

### Atualizar um banco D1 que já existe

Se o banco da Capricho já foi criado antes da trilha de auditoria, abra **D1 → estoque-padaria → Console** e execute o conteúdo completo de [cloudflare/migrations/0002_audit_events.sql](./cloudflare/migrations/0002_audit_events.sql). Essa migração apenas cria a tabela e os índices de auditoria; não apaga nem altera produtos ou movimentações existentes. Até ela ser aplicada, o estoque continua operando e a tela de auditoria informa que falta ativar esse recurso.

### Ativar contas individuais e permissões (recomendado)

Depois da auditoria, abra **D1 → estoque-padaria → Console** e execute todo o conteúdo de [cloudflare/migrations/0003_user_accounts.sql](./cloudflare/migrations/0003_user_accounts.sql). Essa migração só cria a tabela de usuários e índices; não modifica o estoque. Ao atualizar e abrir o aplicativo, ele mostrará a configuração do primeiro administrador. Confirme com a senha compartilhada `APP_PASSWORD` e escolha um nome de usuário e uma nova senha individual de pelo menos 12 caracteres. Após criar o administrador, o login compartilhado deixa de funcionar normalmente e cada pessoa entra com seu próprio usuário e senha.

Os perfis são: **Administrador** (controle completo), **Gerente** (opera o estoque e consulta auditoria/backup), **Operador** (cadastra e movimenta, sem excluir produtos nem exportar backup) e **Consulta** (somente leitura). A redefinição de senha, a mudança de perfil e a desativação invalidam as sessões anteriores da conta.

### 2. Configurar o Worker

1. O banco D1 `estoque-padaria` já está criado e suas tabelas já foram aplicadas.
2. O arquivo [`wrangler.jsonc`](./wrangler.jsonc) já contém o Database ID desse banco. Se recriar o D1 no futuro, atualize esse valor.
3. No Cloudflare, abra **Workers & Pages → Create application**, conecte ao GitHub e selecione `nickebel/estoque`. Use a configuração Wrangler existente para publicar o Worker.
4. Confirme que a configuração de build usa a raiz do repositório e que o comando de deploy é `npx wrangler deploy` (o `package.json` já inclui Wrangler). Na página do Worker, abra **Settings → Variables and Secrets** e adicione dois **secrets**:
   - `APP_PASSWORD`: uma senha forte que a equipe usará para entrar no aplicativo.
   - `SESSION_SECRET`: uma chave aleatória longa e diferente, usada para assinar as sessões.
5. Salve os secrets e publique/reimplante o Worker se o painel pedir.

Não coloque esses dois valores em arquivos do GitHub nem os envie pelo chat. Esta versão usa **uma senha compartilhada pela equipe**, com bloqueio temporário após 8 tentativas incorretas em 15 minutos. Não há identificação individual de cada funcionário no histórico; isso pode ser adicionado em uma etapa futura.

### 3. Ligar o site à API

1. O endereço do Worker já está configurado em [`api-config.js`](./api-config.js): `https://estoque-padaria-api.nas20-e16.workers.dev`.
2. A interface está publicada pelo GitHub Pages, e a API pelo Cloudflare Workers.
3. Entre com a senha definida no secret `APP_PASSWORD`. Para confirmar a sincronização, cadastre um produto de teste e confira-o em outro aparelho autorizado.

O Worker só aceita chamadas do site `https://nickebel.github.io` e dos endereços locais de desenvolvimento listados em `cloudflare/worker.js`. Se usar um domínio personalizado depois, será necessário adicionar a origem permitida.

### Verificação após a publicação

O GitHub Actions valida automaticamente os scripts, o manifesto PWA, o esquema D1 e a configuração Wrangler a cada atualização. A validação pode ser executada localmente com `npm run validate`.

Depois de configurar D1, o Worker e a URL em `api-config.js`, também é possível testar os endpoints sem cadastrar, editar ou apagar produtos:

```powershell
$env:API_BASE_URL = "https://SEU-WORKER.workers.dev"
$secure = Read-Host "Senha da equipe" -AsSecureString
$env:APP_PASSWORD = [System.Net.NetworkCredential]::new("", $secure).Password
# Necessário apenas após ativar contas individuais:
# $env:APP_USERNAME = "usuario.teste"
npm run test:smoke
Remove-Item Env:APP_PASSWORD
```

Troque `https://SEU-WORKER.workers.dev` pelo endereço real do Worker. O teste verifica a API, o login e a leitura de produtos e movimentações; ele não modifica o estoque.

### Avisos

- Os dados passam a vir do banco online quando `api-config.js` contém o endereço do Worker. Enquanto ele estiver vazio, o aplicativo continua no modo local de navegador.
- A versão atual permite entrar com uma senha comum da equipe. O token de sessão expira após 12 horas.
- A lista de produtos e o histórico são recarregados após alterações, ao retornar à janela e automaticamente a cada 60 segundos enquanto o app está aberto. Também há o botão **Atualizar** e o botão **Sair** no cabeçalho.
- O backup JSON no modo online consulta o banco e inclui todos os produtos, até as 5.000 movimentações mais recentes e até 10.000 eventos de auditoria. Se os limites forem atingidos, o arquivo indica truncamento. Faça cópias periódicas em local seguro. O PDF do histórico também pode incluir até 5.000 movimentações; a tela de histórico mostra as 100 mais recentes. Se houver mais de 5.000 registros, faça backups periódicos e mantenha cópias arquivadas. A restauração direta de backup no banco compartilhado ainda está desativada para evitar substituir os dados de toda a equipe acidentalmente.
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
- O acesso online usa inicialmente uma senha compartilhada pela equipe. Por isso, os eventos de auditoria identificam o responsável como equipe, não cada funcionário individualmente. Usuários e permissões individuais continuam sendo uma melhoria futura. Guarde a senha e os secrets do Worker com cuidado; não os publique no repositório.

## Dados e privacidade

Quando `api-config.js` aponta para o Worker, produtos e movimentações são armazenados no Cloudflare D1 e compartilhados com os dispositivos autorizados. O token de sessão fica no armazenamento da sessão da aba (sessionStorage) e expira após 12 horas; ele é removido ao encerrar a sessão no aplicativo e não é mantido intencionalmente entre sessões de navegação. Sem a URL da API, o aplicativo entra em modo local e os dados ficam apenas naquele navegador. Não cadastre dados pessoais desnecessários; exporte backups regularmente e guarde-os em local seguro.
