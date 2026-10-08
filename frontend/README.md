# Delícias Gourmet (React + API)

Requer Node 18+.

    npm install
    npm run dev      # site em http://localhost:5173, API em http://localhost:3001
    npm run build && npm start   # produção: API + site em http://localhost:3001

- Banco SQLite em `data.db` (criado e populado com os 13 produtos na primeira execução).
- `GET /api/products`: cardápio público (sem custos).
- `POST /api/orders`: o servidor recalcula o total com os preços do banco.
- Adicionais: Batata extra, Alface, Tomate e Frango já estão ligados ao Shawarma de Carne e aparecem no pop-up como "preço a definir" até receberem preço. Ative cada um com `node server/addon.js "Batata extra" 3.50`.
- Custos dos produtos começam em 0; preencha `cost_cents` antes de usar relatórios de lucro.

- Os 4 adicionais valem para todos os produtos, exceto Pão de Queijo (que vai direto ao carrinho, sem pop-up). Para tirar um adicional de um produto, apague a linha correspondente em `product_addons`.

## Painel administrativo (/admin)

Crie o usuário do dono (não existe cadastro aberto):

    node server/admin-user.js voce@exemplo.com "uma-senha-com-12-ou-mais-caracteres"

Depois acesse `http://localhost:5173/admin` (dev) ou `/admin` no servidor. Sessão em cookie httpOnly (8 h), limite de 5 tentativas de login por 10 min. Em produção use HTTPS e `NODE_ENV=production`.

- **Empresa**: dias de atendimento (pedidos são recusados em dias fechados, fuso America/Sao_Paulo) e disponibilidade de cada produto.
- **Produtos**: grade com todos os produtos; "Editar" abre o painel com nome, categoria, preço, custo, adicionais, estoque, disponibilidade e números de venda (vendidos, valor bruto, custos e lucro líquido, por unidade e total). "Adicionar produto" cria um novo (a foto é escolhida entre as de `public/assets`).
  - **Adicionais**: o botão redondo "+" abre o pop-up para marcar os adicionais daquele produto. Dentro dele, "Criar novo adicional" pede só nome e valor, e a lixeira exclui o adicional (de todos os produtos, com confirmação). O valor de cada adicional pode ser editado ali mesmo; os 4 antigos "a definir" só podem ser marcados depois de receberem valor.
  - **Estoque**: opcional por produto. Com controle ligado, cada pedido baixa o estoque, pedidos acima do saldo são recusados e, em 0, o produto some do cardápio público. Sem controle, nada muda.
- **Pedidos** (antiga aba Vendas): lista os pedidos confirmados no carrinho, do mais antigo para o mais novo, com foto, itens e total. O botão verde "Concluir pedido" move o pedido para "Concluídos" (dá para reabrir). Clicar no pedido abre ao lado a ficha de produção: cliente, telefone, itens com quantidade, adicionais e observações. A lista atualiza sozinha a cada 20 s. Não há pagamento online no sistema: todo pedido confirmado entra como "a produzir".
- Clicar na logo do painel volta para a página inicial.
  - **Cancelar pedido**: botão vermelho na lista e na ficha do pedido. O painel pergunta se o pedido **já foi produzido**: se sim, o custo vira prejuízo no Administrativo e o estoque não volta; se não, as unidades voltam ao estoque (nos produtos com controle). A aba "Cancelados" permite reabrir (se o estoque ainda comportar).

**Usuário padrão (apenas testes locais):** `admin@delicias.local` / `Delicias@2026!`. É criado automaticamente se o banco não tiver nenhum usuário e `NODE_ENV` não for `production`. Antes de publicar, crie o seu com `node server/admin-user.js` e apague o padrão.

- **Foto do produto**: na edição (e ao adicionar produto) use "Escolher foto". A imagem é reduzida no navegador (lado maior 1200 px) e salva em `uploads/` (ou `UPLOAD_DIR`), servida em `/assets/uploads/`. **Faça backup dessa pasta junto com `data.db`.** Só JPG, PNG e WebP (verificados pelo conteúdo).
- **Administrativo**: planilha com todos os pedidos (por pedido ou por item; colunas ordenáveis, linha de totais, download em CSV) e, ao lado, indicadores e gráficos (por período, mais vendidos, dia da semana, horário; faturamento, lucro ou itens). Filtros por período, status, categoria, produto e busca valem para planilha e gráficos. Considera os últimos 5000 pedidos. O lucro usa o custo cadastrado em cada produto no momento do pedido.

- **Só pedidos concluídos entram no Administrativo** (e nos totais por produto da aba Produtos). Pedidos em andamento e cancelados sem produção ficam de fora. Cancelados já produzidos entram só como prejuízo.
- **Prejuízo** no Administrativo = custo dos pedidos cancelados que já tinham sido produzidos. Lucro líquido = faturamento − custos − prejuízo. Itens vendidos abaixo do custo são avisados à parte. Há também um gráfico só de custos (por período ou por produto).
- **Animações dos botões** (`src/buttons.css`, usado no site e no painel): elevação ao passar o mouse, efeito de pressionar ao clicar e sublinhado animado nos menus. Respeita "reduzir movimento" do sistema.
