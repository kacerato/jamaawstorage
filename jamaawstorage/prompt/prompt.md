app para controle e fiscalizaçao do do meu estoque/almoxarifado. preciso ter um controle de quantidade de quanto sai e pra quem sai.

ter cargo de supervisor

lider

colaborador===== cada colaborador vai ter um inventario, exemplo; ele tem alguns epi, 1 capacete, 1 alicate de corte, isso vai estar detalhado no perfil dele. e se eu adicionar mais 1 alicate de corte no inventario dele vai diminuir 1 do estoque/almoxarifado. é esse controle que eu quero.

aba de costumizaçao de criar os itens do estoque======= nno registro de alguns itens pode conter ca/nr entao coloque esse campo como opcional

especificacoes=====

- Quem autorizou
    

- Quem retirou (nome, matrícula/ID, cargo)
    

- O que retirou (código, descrição, lote
    

- Quanto retirou (quantidade e unidade)
    

- Para quê/para quem, entao pode ser para um colaborador tipo um epi, ou para que tipo bobina de muniçao para usar na vara de manopla na obra, um exemplo
    

- Quando retirou (data/hora automática)
    

Registro fotográfico

Alertas inteligentes

- Estoque mínimo atingido.
    

Assinatura eletrônica

- No momento da retirada, o lider/supervisor e o almoxarife[como testemunha] assinam na tela, gerando um registro com validade jurídica.
    

======== um adendo so quem vai usar esse app sao os supevisores e responnsavel pelo app, os cargos de lideres/colaborador nao terao acesso no momento, entao o os roles deles nao terao muita permisao serao usado pra relatar o inventario de cada um e identficar o lider que pediu a retirada algo do estoque.

exemplo de retirada: eu sou quem autorizo; lucas exemplo lider indio exemplo

vou elaborar duas situacoes lider indio quer retirar 1 epi capacete para colaborador geraldo vai ter todo o sistema de detalhamento de processo de retirada e assinatura. toda a logistica de processo. e so vai ser autorizdo caso alguem autorizar

essa foi a simulaçao de um processo para um funcionario

agora uma situaçao para uma retirada de um utensilio para obra, tipo municao da vara de manopla lider indio pediiu 4 municoes de bobina todo o mesmo processo so que agora nao vai um fncionario em especifico eu detalho que foi retirado pelo indio lider 4 municioes para a obra, mas vai ter o detalhamento no perfil dele. inclsuide poder ver isso poder semana mes/costumizavel. ter um controle

============= Mesmo sem login, é preciso cadastrá-los para associar inventários e retiradas. so pelo supervisor

- **Nome completo, matrícula/ID, cargo** (colaborador ou líder, via dropdown).
    

- **Setor/Obra padrão** (se for líder, indica onde costuma atuar).
    

- **Foto de perfil** (opcional).
    

- **Inventário individual** (tela acessada pelo supervisor).
    

Situação 2: Bobinas de munição para obra

- Nova retirada.
    

- Líder solicitante: Índio.
    

- Destino: Para obra / uso coletivo → seleciona Obra Vara de Manopla (ou digita "Manopla").
    

- Adiciona item: Bobina de munição, qtde 4.
    

- Pode não ter foto, mas assinatura do Índio e do Lucas é obrigatória.
    

- Confirma.
    

- **Resultado:** estoque reduzido, nenhum colaborador ganha inventário, mas o registro fica associado ao líder Índio e à obra.
    

======

5. Perfil do líder e relatórios de controle

👤 Perfil do Líder (acessível pelo supervisor)

Além dos dados cadastrais, haverá abas:

- **Retiradas realizadas:** lista de todas as retiradas em que ele foi o solicitante.
    

- - Filtros: período (última semana, último mês, ou intervalo customizável com calendário).
        

- - Cada linha mostra: data, destino (colaborador X ou obra Y), itens (descrição resumida), valor total, ícone de anexo (foto), ícone de assinatura.
        

- - Toque em um registro para abrir o comprovante completo.
        

- **Resumo de consumo:** gráfico de barras com itens mais retirados por ele no período.
    

📊 Painel de Relatórios (geral)

- **Movimentações por período:** com filtros de líder, colaborador, obra, item.
    

- **Inventário atual de todos os colaboradores** – exportável.
    

- **Curva ABC de saída:** itens mais retirados.
    

- **Itens abaixo do estoque mínimo** (alerta ativo na tela inicial).
    

- **Log de acessos e alterações** (auditoria).
    

- **Criação de kits:** por exemplo, "Kit EPI padrão" (capacete, luva, óculos). Ao selecionar o kit, o app insere automaticamente todos os itens na retirada.
    

linguagem react + typerscript, banco de dados supabase

eu queria um visual mais svg, as logos dos epi por exemplo eu vou colocar parecendo meio cartoon, mas ao mesmo tempo parecendo profissional, cores laranja e preto o app. a logo do site eu quero algo centralizo. quero um app dinamico e autoexplicativo.

Atue como um Desenvolvedor Mobile Sênior especialista em react e typerscript, UI/UX e Arquitetura de Banco de Dados com Supabase. Quero que você crie a arquitetura e os códigos principais para um aplicativo de controle e fiscalização de estoque/almoxarifado corporativo. Por favor, leia atentamente todas as regras de negócio, requisitos técnicos e de design abaixo antes de gerar a solução. ### 2. Design System e Identidade Visual (NOVO) A interface deve fugir do visual corporativo padrão e adotar as seguintes diretrizes: - **Paleta de Cores:** Foco exclusivo nas cores Laranja e Preto (com variações de tons para fundos e contrastes, mantendo um visual limpo). - **Estilos de Ícones e Logos (EPIs):** Os assets dos itens (ex: capacete, alicate, luvas) usarão imagens em formato SVG. - **Direção de Arte:** O visual dos SVGs deve ser estilo "cartoon" (ilustrado, com traços marcantes), mas equilibrado para não parecer infantil. O design geral deve transmitir um ar profissional, tecnológico e direto. ### 3. Regras de Acesso e Perfis (Roles) O aplicativo será operado exclusivamente pela equipe de gestão. Líderes e Colaboradores NÃO terão login no app, mas devem ser cadastrados no sistema pelo Supervisor. - **Supervisor/Almoxarife:** Possui acesso total ao app. Pode cadastrar usuários, itens, criar kits, autorizar retiradas e visualizar relatórios globais. - **Líder:** Entidade no sistema que solicita itens. O líder precisa assinar a retirada presencialmente no app do Supervisor. - **Colaborador:** Entidade que recebe itens de uso pessoal. Possui um "inventário individual" vinculado ao seu perfil. ### 4. Gestão de Estoque e Itens - Cadastro customizável de itens (com campos opcionais como "CA/NR" para EPIs). - **Kits de Retirada:** Funcionalidade para criar "Kits" (ex: "Kit EPI Padrão"). - **Alertas Inteligentes:** O sistema deve alertar visualmente quando um item atingir o "estoque mínimo". ### 5. Lógica de Retirada (Regras de Negócio Core) Toda retirada deve deduzir do estoque principal e registrar: - Quem autorizou e Quem retirou. - O que foi retirado e Quantidade. - Destino/Para quem (ex: "Para colaborador X" ou "Para a obra Y"). - Quando (Data/Hora). - **Evidências Obrigatórias:** Registro fotográfico suportado e Assinatura Eletrônica na tela do dispositivo (validade jurídica). ### 6. Casos de Uso (Exemplos Práticos) - **Situação 1 (EPI para colaborador):** O líder "Índio" solicita 1 capacete para "Geraldo". O supervisor ("Lucas") autoriza. Ambos assinam no app. O estoque geral diminui em 1, e o inventário de "Geraldo" passa a ter 1 capacete. - **Situação 2 (Uso Coletivo/Obra):** O líder "Índio" solicita 4 bobinas de munição para uso geral na obra "Vara de Manopla". O supervisor autoriza. Ambos assinam. O estoque diminui em 4. Nenhum colaborador recebe os itens, mas o registro fica atrelado ao histórico do líder "Índio" e à obra. ### 7. Relatórios e Perfis - **Perfil do Líder:** Histórico de retiradas (com filtros), gráfico de consumo e dados cadastrais. - **Painel de Relatórios (Geral):** Movimentações, Inventário exportável, Curva ABC, itens abaixo do mínimo e Log de auditoria.