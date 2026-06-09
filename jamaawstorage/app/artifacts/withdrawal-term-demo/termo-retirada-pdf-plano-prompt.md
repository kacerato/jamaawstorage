# Plano e prompt do PDF de termo de retirada

## Objetivo

Automatizar a geração do PDF "Termo de Retirada do Almoxarifado" antes da confirmação final da retirada e antes da anexação da assinatura. O usuário deve conseguir gerar:

- PDF geral: um único arquivo com uma página por destino/responsável.
- PDFs individuais: um arquivo por destino/responsável.

O layout deve seguir o modelo enviado: A4 retrato, logo Jamaaw centralizada, texto institucional fixo, tabela de solicitante/CPF, tabela de itens, bloco de assinaturas e data automática.

## Regras de agrupamento

1. Cada termo representa um destino/responsável.
2. Para destino do tipo colaborador, o responsável do termo é o colaborador daquele grupo.
3. Para destino do tipo obra, o responsável do termo é o líder ou supervisor selecionado como solicitante da retirada.
4. Se uma retirada tiver três destinos diferentes, o PDF geral terá três páginas e a opção individual gerará três PDFs.
5. Se uma retirada tiver dois colaboradores e uma obra, serão dois termos para os colaboradores e um termo da obra em nome do líder/supervisor solicitante.
6. Os itens devem ser filtrados por grupo, usando o destino informado em cada item. Se o item não tiver destino próprio, usar o destino principal da retirada.

## Campos automáticos

- Nome: vindo do colaborador ou do líder/supervisor solicitante, conforme regra de agrupamento.
- CPF: vindo da pessoa responsável pelo termo, formatado como `000.000.000-00` quando possível.
- Itens: quantidade e descrição vindas dos itens selecionados na retirada.
- Data: gerada automaticamente no formato `dd / MM / yyyy`. Para retirada salva, usar `withdrawn_at`, depois `updated_at`, depois `created_at`; para retirada ainda em criação, usar a data atual.
- Logo: usar a logo Jamaaw enviada ou o asset oficial do app.

## Texto fixo do documento

Título:

`TERMO DE RETIRADA DO ALMOXARIFADO`

Subtítulo:

`JAMAAW SOLUÇÕES INTELIGENTES`

Texto principal:

`Declaro, para os devidos fins, que os itens abaixo relacionados foram retirados do almoxarifado JAMAAW. O solicitante declara estar ciente do recebimento dos materiais, responsabilizando-se pelo uso adequado, guarda, conservação e zelo de todos os itens retirados, comprometendo-se a devolvê-los em boas condições, salvo desgaste natural de uso.`

Aviso:

`IMPORTANTE: O solicitante é responsável por zelar pelos materiais retirados e utilizá-los de forma adequada e segura.`

## Prompt de implementação

Implemente no app Jamaaw Storage um gerador de PDF para "Termo de Retirada do Almoxarifado" com layout A4 retrato igual ao modelo de referência. O gerador deve receber dados normalizados da retirada e produzir documentos antes da confirmação final e antes da anexação da assinatura.

Crie um tipo neutro `WithdrawalTermDocument` com: `responsibleName`, `responsibleCpf`, `items`, `date`, `destinationLabel` e `kind`. Crie mapeadores separados para retirada em rascunho (`NewWithdrawalPage`) e retirada já salva (`WithdrawalDetailPage`/`EditWithdrawalPage`), evitando acoplar o PDF diretamente ao formato bruto do Supabase.

O agrupamento deve gerar um documento por destino/responsável: colaborador usa o próprio colaborador; obra usa o líder/supervisor solicitante. A opção "PDF geral" deve gerar um único PDF com uma página por grupo. A opção "PDF individual" deve gerar/downloadar um PDF por grupo. Não duplicar o conceito de anexo de assinatura: o PDF é uma prévia/termo gerado; a assinatura continua sendo anexada depois no contrato compartilhado já existente.

Use as cores do modelo: azul-marinho escuro para títulos/cabeçalhos, cinza claro para faixas e bordas discretas. Manter os textos fixos exatamente como especificados. A data deve ser automática em `dd / MM / yyyy`. As tabelas devem quebrar página com segurança quando houver muitos itens, preservando o bloco de assinaturas na última página do termo.

Valide com os cenários: uma obra com líder solicitante; um colaborador; dois colaboradores e uma obra na mesma retirada; três destinos diferentes; lista longa de itens.
