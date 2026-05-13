# Plano de Ação - Auto-Seleção como Solicitante (Almoxarife)

## O Problema
Atualmente, a tela de **Nova Retirada** exige a seleção de um "Líder Solicitante" para registrar quem pediu os itens. No banco de dados, o campo `requested_by` aponta para um registro na tabela `people` (pessoas). Como os administradores/almoxarifes geralmente acessam o sistema via login (`profiles`) e não necessariamente estão listados como "líderes" na tabela `people`, eles não conseguem se selecionar.

## O Objetivo
Permitir que o usuário logado (Almoxarife/Administrador) possa se escolher ou ser definido automaticamente como o solicitante da retirada, garantindo que todo o fluxo (listagens, detalhes e relatórios) reflita essa informação de forma correta e sem quebrar as dependências do banco de dados.

## A Solução Planejada

### 1. Ajuste na Tela de Retirada (Frontend)
- Modificar a consulta no arquivo `NewWithdrawalPage.tsx` que busca os líderes. Hoje ela busca apenas `role = 'leader'`. Vamos alterar para buscar `in('role', ['leader', 'supervisor'])`. Dessa forma, qualquer supervisor cadastrado na aba Pessoas aparecerá na lista.
- Adicionar um atalho na interface: Um botão **"Fui eu mesmo"** ou injetar automaticamente o perfil logado como uma opção "Eu (Almoxarifado)".

### 2. Sincronização Perfil -> Pessoa
- Como o banco de dados exige um ID válido da tabela `people`, o usuário logado precisa ter um cadastro lá.
- *Opção A:* Instruir a criação do cadastro do próprio almoxarife na aba "Pessoas" com o cargo de "Supervisor".
- *Opção B (Recomendada):* Modificar a lógica do Frontend para verificar se o usuário logado existe na tabela `people`. Se não existir e ele clicar em "Fui eu mesmo", o sistema pode usar um cadastro genérico de "Almoxarifado Interno" ou criar o registro dele na hora.
- *Nossa Abordagem:* O mais seguro e que respeita todo o fluxo (sem quebrar os relatórios atuais) é garantir que o **Almoxarife tenha um registro na tabela `people`** (como supervisor) e que essa opção apareça destacada no Dropdown de Líderes.

### 3. Ajuste em Relatórios e Listagens
- No arquivo `ReportsPage.tsx` e `WithdrawalsPage.tsx`, o sistema já busca `requested_by_person?.full_name`. Se o almoxarife estiver cadastrado em `people`, a exibição funcionará perfeitamente sem necessidade de alterar as consultas SQL complexas.
- O filtro de relatórios também buscará os supervisores na lista de "Filtrar por Líder".

**Próximo passo:** Aguardando sua aprovação para modificar o `NewWithdrawalPage.tsx` (para buscar líderes e supervisores) e os filtros de relatórios, adequando o sistema sem quebrar o banco de dados.
