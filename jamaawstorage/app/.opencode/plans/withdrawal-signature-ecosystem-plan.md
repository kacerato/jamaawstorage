# Plano revisado: PDFs assinados opcionais por pessoa

## 1. Escopo correto

A geracao atual dos termos PDF nao sera redesenhada.

- O PDF geral e os PDFs individuais continuam sendo gerados como hoje.
- A retirada deixa de exigir qualquer PDF assinado no momento da criacao.
- O PDF assinado podera ser anexado durante a nova retirada, mas sera sempre opcional.
- Quando o documento ainda nao estiver assinado, o supervisor conclui a retirada normalmente e anexa depois, separadamente, o PDF de cada pessoa.
- Cada PDF assinado fica ligado ao mesmo tempo a retirada e a pessoa responsavel.
- A pagina individual de cada colaborador ou lider ganha uma aba `Documentos`, onde todo esse historico fica organizado.

O objetivo nao e criar assinatura digital nem extrair imagens de assinatura. O documento oficial sera o PDF individual assinado.

## 2. Situacao atual que precisa mudar

O banco ja aceita assinaturas nulas desde `025_allow_nullable_withdrawal_signatures.sql`, mas `NewWithdrawalPage.tsx` ainda bloqueia o processo:

1. A etapa `Documentacao e Assinaturas` exige um arquivo ou assinatura extraida.
2. O `handleSubmit` repete essa exigencia.
3. O arquivo compartilhado e gravado nas colunas do supervisor e do solicitante.
4. A tela tenta extrair duas imagens de assinatura do PDF.
5. A lista de retiradas considera apenas essas duas imagens para exibir o estado de assinatura.

Esse contrato deve ser substituido. As colunas antigas permanecem apenas durante a migracao do historico.

## 3. Fluxo desejado

### Momento 1 - criar a retirada

1. Selecionar solicitante, itens e destinos.
2. Gerar PDF geral ou PDFs individuais, se o usuario quiser imprimir antes de concluir.
3. Para cada pessoa listada, anexar o PDF individual assinado se ele ja estiver disponivel, ou deixar pendente.
4. Confirmar a retirada independentemente da quantidade de PDFs anexados.
5. A RPC registra a retirada e movimenta o estoque normalmente.
6. O sistema cria um requisito documental para cada PDF individual esperado.
7. Os arquivos opcionais selecionados sao vinculados aos respectivos requisitos.
8. A retirada fica operacionalmente `completed`; o estado documental pode iniciar `Pendente`, `Parcial` ou `Completo`.

Assinatura nao bloqueia estoque, inventario, retirada ou notificacao.

### Momento 2 - colher as assinaturas

1. Os PDFs individuais continuam sendo impressos ou enviados como atualmente.
2. Cada colaborador ou lider assina o seu documento fora do sistema.
3. O documento e digitalizado como PDF.

### Momento 3 - anexar depois

1. Abrir o detalhe da retirada.
2. Acessar o card `PDFs assinados por pessoa`.
3. O sistema mostra uma linha para cada colaborador ou lider esperado.
4. Clicar em `Anexar PDF assinado` na pessoa correta.
5. Enviar somente o PDF daquela pessoa.
6. Confirmar o nome, retirada e destino antes de salvar.
7. O documento passa de `Pendente` para `Anexado`.
8. Repetir para os demais participantes.

Depois da criacao, o upload deve ser uma operacao documental separada. Ele nao deve exigir reabrir o formulario que altera itens, quantidades ou destinos da retirada.

### Momento 4 - consultar pela pessoa

Na pagina do colaborador ou lider, a aba `Documentos` mostra:

- documentos pessoais ja existentes;
- PDFs assinados de retiradas;
- retiradas que ainda aguardam o PDF dessa pessoa;
- documentos substituidos ou rejeitados;
- data, codigo da retirada, destino, arquivo e responsavel pelo upload.

O mesmo PDF nao sera copiado para o cadastro da pessoa. A aba consulta o documento pelo vinculo com `person_id`, mantendo uma unica fonte de verdade.

## 4. Como determinar os PDFs individuais esperados

A lista deve seguir exatamente os grupos usados hoje para gerar os PDFs individuais:

- Destino colaborador: uma pendencia para o colaborador destinatario.
- Destino obra: uma pendencia para o lider solicitante responsavel pela retirada naquela obra.
- A mesma pessoa com varios itens no mesmo destino gera uma unica pendencia.
- A mesma pessoa ligada a destinos diferentes pode ter documentos individuais diferentes, pois os termos representam contextos diferentes.

Cada pendencia precisa de uma chave estavel de escopo:

- `collaborator:{collaborator_id}`
- `work_site:{work_site_id}:leader:{requested_by}`

Essa chave deve ser produzida por uma funcao compartilhada e seguir a mesma regra usada na geracao dos PDFs. Assim, a tela nao cria um documento para uma pessoa enquanto o gerador cria outro agrupamento.

## 5. Modelo de banco recomendado

Nao usar `people.document_attachments` para termos de retirada. Esse JSON serve aos documentos cadastrais e nao oferece relacionamento, auditoria ou versoes suficientes.

### 5.1 `withdrawal_document_requirements`

Representa cada PDF individual que precisa voltar assinado.

- `id uuid primary key`
- `withdrawal_id uuid not null`
- `person_id uuid not null`
- `scope_key text not null`
- `destination_type withdrawal_destination_type not null`
- `collaborator_id uuid null`
- `work_site_id uuid null`
- `status text not null`: `pending`, `attached`, `rejected`, `replaced`, `not_required`
- `person_name_snapshot text not null`
- `person_role_snapshot text not null`
- `destination_label_snapshot text not null`
- `due_at timestamptz null`
- `created_at`, `updated_at`

Restricao unica: `withdrawal_id + scope_key`.

Essas linhas sao criadas junto com a retirada. Portanto, uma retirada sem PDF ja aparece imediatamente como pendencia para cada pessoa.

### 5.2 `withdrawal_person_documents`

Guarda os arquivos enviados e suas versoes.

- `id uuid primary key`
- `requirement_id uuid not null`
- `withdrawal_id uuid not null`
- `person_id uuid not null`
- `version integer not null`
- `status text not null`: `active`, `replaced`, `rejected`
- `storage_path text not null`
- `file_name text not null`
- `mime_type text not null`
- `file_size bigint not null`
- `sha256 text null`
- `uploaded_by uuid not null`
- `uploaded_at timestamptz not null`
- `rejection_reason text null`
- `rejected_by uuid null`
- `rejected_at timestamptz null`
- `supersedes_document_id uuid null`
- `notes text null`

Regras:

- somente um documento `active` por pendencia;
- novo upload substitui logicamente o anterior, mas nunca apaga o historico;
- `withdrawal_id` e `person_id` devem coincidir com a pendencia vinculada;
- o arquivo pertence a uma pessoa e uma retirada especificas;
- nenhum arquivo deve ser duplicado em mais de uma coluna ou cadastro.

### 5.3 Resumo documental

Criar uma view `withdrawal_document_summary` com:

- `expected_count`
- `attached_count`
- `pending_count`
- `rejected_count`
- `document_status`: `pending`, `partial`, `complete`, `rejected`, `not_required`

O `withdrawal.status` continua representando a operacao de estoque. Nao adicionar status de assinatura ao enum da retirada.

## 6. Mudancas na Nova Retirada

### Remover

- obrigatoriedade da etapa de assinatura;
- extracao automatica das imagens de assinatura;
- `persistSignatureSnapshots`;
- bloqueios existentes em `validateStep(2)` e `handleSubmit`;
- escrita duplicada nas colunas `supervisor_signature_attachment_*` e `requester_signature_attachment_*`;
- envio das imagens de assinatura para a RPC.

### Manter

- geracao do PDF geral;
- geracao dos PDFs individuais;
- layout atual dos termos;
- fotos operacionais opcionais;
- observacoes;
- validacao do estoque e dos destinos;
- notificacao Telegram da retirada.

### Substituir o upload compartilhado por upload individual opcional

- Mostrar uma linha para cada pessoa/escopo gerado pelos destinos selecionados.
- Permitir selecionar um PDF individual em cada linha.
- Nao exigir nenhum arquivo para avancar ou concluir.
- Se somente parte das pessoas tiver arquivo, permitir concluir e iniciar o estado documental como `Parcial`.
- Manter os arquivos selecionados localmente ate a retirada existir; nao criar vinculos definitivos usando IDs temporarios.
- Depois que a RPC criar a retirada e os requisitos documentais, enviar e registrar cada PDF no requisito correto.
- Se um upload opcional falhar, a retirada continua concluida e o requisito permanece pendente para nova tentativa.
- Exibir no sucesso quantos PDFs foram anexados e quantos ficaram pendentes.

### Ajustar a interface

- Renomear a etapa para `Documentos individuais`.
- Exibir: `Anexe agora os PDFs que ja estiverem assinados. Os demais podem ser enviados depois.`
- Botao final: `Registrar retirada`.
- Sucesso: `Retirada registrada. X PDFs anexados e N aguardando assinatura.`

## 7. Mudancas no detalhe da retirada

Adicionar o card `PDFs assinados por pessoa`.

Cada linha apresenta:

- nome da pessoa;
- tipo: colaborador ou lider;
- destino relacionado;
- estado: pendente, anexado ou rejeitado;
- data do upload;
- botao `Anexar PDF assinado` ou `Substituir PDF`;
- botao `Abrir PDF`;
- acesso ao historico de versoes.

O modal de upload deve:

1. Mostrar retirada, pessoa e destino no cabecalho.
2. Aceitar apenas `.pdf`.
3. Validar MIME, cabecalho do PDF e tamanho maximo.
4. Pedir confirmacao antes de vincular.
5. Salvar arquivo com caminho unico.
6. Registrar banco e auditoria atomicamente.
7. Atualizar o progresso sem recarregar toda a pagina.

O detalhe continua oferecendo `PDF Geral` e `PDFs Individuais` exatamente como hoje.

## 8. Aba Documentos da pessoa

Adicionar `documents` ao `TabType` de `PersonDetailPage.tsx` para colaboradores e lideres.

### Secao Documentos pessoais

- Exibir os anexos cadastrais que hoje aparecem em `Dados Cadastrais`.
- Manter inclusao e edicao pelo formulario da pessoa.
- No futuro, o JSON pode ser normalizado, mas isso nao bloqueia este projeto.

### Secao Termos de retirada assinados

- Cards: total, pendentes e anexados.
- Filtros por periodo, estado, codigo e destino.
- Tabela com retirada, data, destino, estado e arquivo.
- Botao `Anexar agora` nas pendencias.
- Botao `Abrir retirada` para visualizar o contexto completo.
- Historico de versoes quando um PDF foi substituido.

Para colaborador, consultar pendencias onde ele e o destino. Para lider, consultar pendencias de retiradas/obras pelas quais ele foi o responsavel.

Essa aba e o principal ecossistema individual solicitado. Uma central global pode ser criada depois, mas nao e necessaria para entregar o fluxo principal corretamente.

## 9. Lista de retiradas

Substituir a coluna atual, baseada em duas imagens, por progresso documental:

- `0/2 PDFs - Pendente`
- `1/2 PDFs - Parcial`
- `2/2 PDFs - Completo`
- `PDF rejeitado`

Adicionar filtros `Pendentes`, `Parciais`, `Completos` e `Rejeitados`. O clique abre o detalhe, onde o upload individual acontece.

## 10. Edicao e consistencia

Adicionar PDF nao deve exigir editar a retirada operacional.

Se uma retirada for realmente editada:

- mudanca apenas em observacoes nao invalida documentos;
- mudanca de item sem alterar pessoa/destino exige uma decisao explicita de gerar novo termo;
- mudanca de pessoa ou destino encerra a pendencia antiga como `replaced` e cria outra;
- PDF ja anexado nunca e apagado; fica historico da versao anterior;
- cancelamento da retirada preserva os documentos, mas marca as pendencias como nao exigidas/canceladas.

Uma funcao SQL deve reconciliar os `scope_key` depois da edicao, sem recriar indiscriminadamente todas as pendencias.

## 11. Armazenamento e seguranca

- Criar bucket privado `withdrawal-signed-documents`.
- Armazenar `storage_path`, nunca URL publica permanente.
- Abrir arquivos por URL assinada de curta duracao.
- Permitir upload somente a supervisor ativo.
- Caminho: `{withdrawal_id}/{requirement_id}/v{version}-{uuid}.pdf`.
- Validar extensao, MIME, assinatura `%PDF`, tamanho e hash.
- Nao sobrescrever arquivo existente.
- Registrar uploader, data, substituicao e rejeicao.
- Aplicar RLS, grants minimos e auditoria nas duas tabelas.
- Falha de upload nao pode alterar retirada ou estoque.
- Se o upload fisico funcionar e o banco falhar, executar limpeza compensatoria do arquivo orfao.

## 12. Telegram e notificacoes

- Criacao: notificar retirada normalmente e informar quantos PDFs foram anexados e quantos aguardam assinatura.
- Nao tentar enviar assinatura inexistente.
- Upload posterior: notificacao opcional `PDF assinado anexado para Nome - Retirada CODIGO`.
- Rejeicao/substituicao: registrar notificacao interna.
- Falha de Telegram nunca bloqueia retirada nem upload.

## 13. Migracao do historico

1. Criar as novas tabelas e politicas sem remover colunas atuais.
2. Gerar pendencias historicas usando os mesmos grupos dos PDFs individuais.
3. Importar o documento compartilhado antigo somente uma vez.
4. Quando um documento antigo nao puder ser atribuido com seguranca a uma pessoa, marca-lo como legado geral, sem inventar vinculo individual.
5. Ignorar imagens transparentes usadas como placeholder nas RPCs antigas.
6. Manter leitura das colunas antigas durante a transicao.
7. Parar de escrever nelas desde a nova tela.
8. Remover colunas e fallbacks apenas em uma migration posterior, depois da verificacao em producao.

## 14. RPCs necessarias

- `create_withdrawal_document_requirements(p_withdrawal_id)`: chamada dentro da criacao da retirada.
- `register_withdrawal_person_document(p_requirement_id, p_file_metadata)`: valida pessoa/retirada e registra nova versao.
- `replace_withdrawal_person_document(p_requirement_id, p_file_metadata, p_reason)`: substitui preservando historico.
- `reject_withdrawal_person_document(p_document_id, p_reason)`: rejeicao auditada.
- `reconcile_withdrawal_document_requirements(p_withdrawal_id)`: ajusta pendencias depois de editar destinos.

As funcoes `SECURITY DEFINER` devem fixar `search_path`, validar `is_active_supervisor()` e expor apenas os grants necessarios.

## 15. Fases de implementacao

### Fase 1 - banco e contrato

- Criar migration das duas tabelas, indices, checks, RLS e auditoria.
- Criar a view de resumo.
- Criar a funcao unica que transforma grupos de destino em pendencias individuais.
- Atualizar tipos TypeScript pelo schema real.

### Fase 2 - tornar o upload individual opcional

- Substituir o upload compartilhado pelo upload individual opcional na nova retirada.
- Remover somente a extracao de imagens e a obrigatoriedade de arquivo.
- Retirar validacoes duplicadas.
- Enviar assinaturas nulas para o contrato transitorio ou remover parametros na nova RPC.
- Criar pendencias junto com a retirada.
- Vincular os PDFs opcionais depois que os requisitos reais existirem.
- Tratar falha de um PDF como pendencia recuperavel, sem apresentar a retirada como nao criada.
- Manter geracao dos PDFs atuais intacta.

### Fase 3 - upload posterior por pessoa

- Criar card e modal no detalhe da retirada.
- Implementar upload, substituicao e abertura segura.
- Mostrar progresso individual e agregado.

### Fase 4 - aba Documentos

- Criar aba para colaborador e lider.
- Mover visualizacao dos documentos cadastrais para essa aba.
- Adicionar pendencias e PDFs de retirada vinculados a pessoa.
- Implementar filtros e historico.

### Fase 5 - lista, notificacoes e legado

- Atualizar coluna e filtros da lista de retiradas.
- Ajustar Telegram.
- Executar backfill idempotente.
- Validar registros antigos antes de descontinuar as colunas legadas.

## 16. Criterios de aceite

- E possivel registrar retirada sem anexar qualquer PDF.
- E possivel anexar zero, um ou varios PDFs individuais durante a criacao.
- Nenhum PDF e obrigatorio para concluir a retirada.
- PDFs geral e individuais continuam sendo gerados como hoje.
- Cada grupo individual gera uma pendencia para a pessoa correta.
- Depois da assinatura, o PDF e anexado individualmente pelo detalhe da retirada ou pela aba da pessoa.
- O mesmo documento aparece na retirada e na pessoa sem duplicar arquivo.
- Colaborador e lider possuem aba Documentos organizada.
- A lista mostra progresso real por quantidade de PDFs esperados.
- Substituicoes preservam versoes antigas.
- Alteracoes de destino reconciliam as pendencias sem perder historico.
- Arquivos sao privados e auditados.
- Placeholders antigos nao contam como PDF assinado.
- Erros de upload ou Telegram nao afetam estoque nem a retirada concluida.

## 17. Matriz minima de testes

1. Retirada para um colaborador sem PDF.
2. Retirada para um colaborador com PDF opcional anexado durante a criacao.
3. Retirada para dois colaboradores com somente um PDF: estado parcial.
4. Retirada para dois colaboradores sem arquivos, criando duas pendencias.
5. Retirada para obra vinculada ao lider correto.
6. Geracao do PDF geral e individual sem regressao visual.
7. Upload posterior do PDF pendente: estado completo.
8. Falha de um upload opcional sem desfazer ou ocultar a retirada criada.
9. Consulta dos documentos nas paginas individuais corretas.
10. Lider com documentos de duas obras diferentes.
11. Substituicao de PDF incorreto preservando versao anterior.
12. Edicao que troca colaborador ou destino.
13. Cancelamento com PDF ja anexado.
14. Tentativa de anexar PDF de uma pessoa na pendencia de outra.
15. Arquivo invalido, duplicado ou acima do tamanho.
16. Backfill de documento compartilhado legado sem duplicacao.

## 18. Decisoes fechadas por este plano

- Nao mudar a forma atual de gerar PDFs.
- Permitir PDF durante a retirada, sempre de maneira individual e opcional.
- Permitir anexar depois qualquer PDF que tenha ficado pendente.
- Usar o PDF individual assinado como evidencia oficial.
- Criar aba Documentos para colaborador e lider.
- Manter uma unica copia do arquivo, acessivel pela retirada e pela pessoa.
- Nao criar banco de imagens reutilizaveis de assinatura.
