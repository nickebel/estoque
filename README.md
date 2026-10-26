# Estoque da Padaria

Aplicação web simples para cadastrar produtos, acompanhar saldo e gerar relatórios PDF.

## Funcionalidades

- Cadastro manual de produtos, categorias, unidade de controle, quantidade atual, limite mínimo e observações.
- Unidades flexíveis: caixas, fardos, pacotes, sacos, kg, litros e qualquer unidade digitada pela equipe.
- Entradas e saídas com atualização automática do saldo; bloqueia saídas acima do estoque disponível.
- Busca rápida por nome, categoria e observação.
- PDF de consulta individual, estoque completo e histórico de movimentações.
- Compartilhamento do PDF quando o navegador/dispositivo oferece suporte; nos demais casos o arquivo é baixado para envio manual.
- Backup JSON e restauração dos dados.
- Layout adaptado para computador e celular.

## Publicar com GitHub Pages

1. No repositório **nickebel/estoque**, entre em **Settings → Pages**.
2. Em **Build and deployment**, selecione **Deploy from a branch**.
3. Escolha a branch **main** e a pasta **/(root)** e salve.
4. Aguarde a publicação. O endereço do site será exibido nas configurações do Pages, normalmente `https://nickebel.github.io/estoque/`.

O arquivo de entrada é `index.html`; não é necessário instalar dependências ou compilar o projeto.

## Preparar o banco compartilhado (Supabase)

O script inicial do banco está em [`supabase/schema.sql`](./supabase/schema.sql). Ele cria produtos, membros da equipe e histórico de movimentações, com políticas RLS e uma função transacional para atualizar o saldo junto com o histórico.

1. Crie um projeto no [Supabase](https://supabase.com/dashboard) e guarde a senha do banco em um lugar seguro.
2. No projeto, abra **SQL Editor → New query**.
3. Abra o arquivo [`supabase/schema.sql`](./supabase/schema.sql), copie todo o SQL para o editor do Supabase e execute.
4. Em **Authentication → Users**, crie ou convide a conta do primeiro responsável.
5. Na lista de usuários, copie o UUID desse usuário. No SQL Editor, registre essa pessoa como administradora, substituindo `UUID-DO-USUARIO` pelo UUID real:

   ```sql
   insert into public.team_members (user_id, role)
   values ('UUID-DO-USUARIO', 'admin');
   ```

6. Crie as contas dos demais funcionários em Authentication → Users e adicione cada UUID à tabela `public.team_members` com o papel `staff`.
7. No painel **Connect** do Supabase, copie o **Project URL** e a **publishable key** (ou a chave legada `anon`, se for a exibida pelo projeto). Essas informações públicas são usadas para identificar o projeto; as políticas RLS protegem os dados. **Nunca coloque a secret key ou service_role key no site nem envie essas chaves secretas no chat.**

**Importante:** este script prepara as tabelas e a proteção no banco, mas o app ainda precisa receber o formulário de login e trocar a leitura/gravação local pela API do Supabase antes de usar esses dados compartilhados. Até essa integração ser concluída, o app atual continua salvando no navegador.

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

- Os dados ficam no armazenamento local do navegador e dispositivo que está sendo usado. O site publicado pode ser aberto em vários aparelhos, mas **os dados ainda não são compartilhados nem sincronizados entre eles**.
- Faça backups regularmente em **Relatórios e backup**.
- O gerador de PDF usa jsPDF por CDN, então precisa de conexão com a internet. Se a biblioteca não carregar, tente novamente com internet.
- O botão de compartilhar usa o menu de compartilhamento do próprio dispositivo quando disponível. Caso contrário, baixa o PDF para você anexá-lo manualmente no WhatsApp ou em outro aplicativo.
- Esta é uma versão inicial, sem login de funcionários ou banco de dados central. Para a equipe trabalhar com um estoque único em vários dispositivos, a próxima etapa é integrar um banco de dados online e autenticação.

## Dados e privacidade

Os dados do estoque são mantidos no navegador por meio de `localStorage`. Não cadastre informações pessoais desnecessárias. Antes de limpar os dados do navegador, exporte um backup.
