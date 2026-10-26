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
