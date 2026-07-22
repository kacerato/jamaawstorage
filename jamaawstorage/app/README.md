# Jamaaw Storage

Sistema web para controle de almoxarifado, retiradas, devolucoes, inventario de colaboradores, kits, relatorios e auditoria operacional.

Projeto desenvolvido por **Lucas**, desenvolvedor junior, com foco em criar uma aplicacao real de gestao de estoque usando React, TypeScript e Supabase.

## Visao Geral

O Jamaaw Storage centraliza o controle de itens do almoxarifado e os fluxos que normalmente ficam espalhados em planilhas, conversas e documentos avulsos. A aplicacao permite cadastrar itens, montar kits, registrar retiradas, controlar devolucoes, acompanhar historico de movimentacoes, manter inventario individual de colaboradores e gerar relatorios para conferencia.

## Principais Funcionalidades

- Dashboard com indicadores de estoque, retiradas e alertas.
- Cadastro e edicao de itens de estoque.
- Controle de quantidade por estado: novo, usado e avariado.
- Importacao de documentos para auxiliar cadastro de itens via API.
- Kits de retirada com itens predefinidos.
- Retiradas com multiplos itens, destino por colaborador ou obra e termo para impressao.
- Edicao de retiradas ja concluidas com ajuste de estoque.
- Devolucoes com triagem, aprovacao parcial, itens retidos e historico.
- Inventario individual de colaboradores.
- Cadastro de colaboradores com documentos, CPF e anexos.
- Gestao de obras, supervisores e veiculos.
- Analise de imagens de veiculos via API.
- Relatorios de estoque, movimentacoes, inventario, curva ABC, estoque baixo e consumo por lider.
- Historico de movimentacoes com filtros por tipo, origem, busca textual, data e hora.
- Auditoria de alteracoes relevantes.
- Notificacao de retiradas via Telegram.
- Autenticacao e controle de acesso via Supabase.

## Stack

- **React 19**
- **TypeScript**
- **Vite**
- **Tailwind CSS**
- **Supabase Auth**
- **Supabase Database**
- **Supabase Storage**
- **Supabase RPC, triggers e RLS**
- **React Router**
- **jsPDF e jspdf-autotable**
- **Tesseract.js**
- **pdfjs-dist**
- **Vercel Serverless Functions**

## Estrutura do Projeto

```text
app/
  api/                    # Funcoes serverless usadas localmente e na Vercel
  public/                 # Assets publicos
  src/
    components/           # Componentes reutilizaveis de UI, layout, icons e itens
    context/              # Contextos globais
    hooks/                # Hooks reutilizaveis
    lib/                  # Cliente Supabase, storage e utilitarios
    pages/                # Paginas principais do sistema
    services/             # Servicos de dominio
    types/                # Tipos TypeScript e Database Supabase
  supabase/
    migrations/           # Historico de migracoes SQL
  vercel.json             # Regras de deploy SPA + API
  vite.config.ts          # Vite, React, Tailwind e APIs locais
```

## Modulos Principais

- **Estoque**: itens, categorias, quantidades, estados de conservacao, estoque minimo, importacao e historico.
- **Movimentacoes**: consolidacao de entradas, saidas, devolucoes e ajustes a partir de auditoria, retiradas e devolucoes.
- **Retiradas**: criacao, edicao, assinatura, anexos, impressao de termo e notificacao.
- **Devolucoes**: retorno de itens ao estoque, triagem, aprovacao parcial e itens retidos.
- **Kits**: agrupamento de itens para acelerar retiradas recorrentes.
- **Colaboradores**: dados pessoais, documentos, inventario, consumo e historico.
- **Obras**: cadastro e relacao com retiradas.
- **Veiculos**: frota, logs, fotos, documentos e analise por IA.
- **Relatorios**: exportacoes e visoes consolidadas.
- **Auditoria**: rastreio de alteracoes criticas.
- **JAMAAW Assistente**: central operacional movel com anexos, memoria por gatilhos, consultas agregadas e confirmacao obrigatoria para alteracoes.

## Variaveis de Ambiente

Crie um arquivo `.env` na raiz de `app/` para desenvolvimento local.

```env
VITE_SUPABASE_URL=
VITE_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

KIMI_API=
KIMI_CHAT_MODEL=kimi-k3
ZAI_API_KEY=
VEHICLE_CV_SERVICE_URL=
VEHICLE_CV_SERVICE_TOKEN=

TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
TELEGRAM_CHANNEL_URL=
```

### Obrigatorias

- `VITE_SUPABASE_URL`: URL do projeto Supabase.
- `VITE_SUPABASE_ANON_KEY`: chave anon publica do Supabase.
- `SUPABASE_SERVICE_ROLE_KEY`: segredo exclusivo do backend para persistir conversas, memorias e confirmacoes. Nunca exponha com prefixo `VITE_`.

### Opcionais conforme recurso

- `KIMI_API`: usada na importacao inteligente e no assistente operacional autenticado.
- `KIMI_CHAT_MODEL`: modelo do chat; o padrao e `kimi-k3`.
- `VEHICLE_CV_SERVICE_URL`: URL do serviço Python em `vehicle-cv-service/`. Esta e a via rapida e deterministica para leitura de painel.
- `VEHICLE_CV_SERVICE_TOKEN`: segredo compartilhado entre a Vercel e o serviço Python; use o mesmo valor nos dois ambientes.
- `ZAI_API_KEY`: fallback visual usado somente quando a leitura Python estiver ausente ou abaixo da confianca minima.
- `TELEGRAM_BOT_TOKEN`: token do bot Telegram.
- `TELEGRAM_CHAT_ID`: canal, grupo ou chat numerico para envio de notificacoes.
- `TELEGRAM_CHANNEL_URL`: link publico ou convite do canal, usado como apoio visual.

## Como Rodar Localmente

```bash
npm install
npm run dev
```

O Vite inicia a aplicacao e tambem registra handlers locais para:

- `/api/kimi-stock-import`
- `/api/kimi-assistant`
- `/api/telegram-withdrawal-notify`
- `/api/vehicle-image-analysis`

## Scripts

```bash
npm run dev
npm run build
npm run lint
npm run preview
```

- `dev`: inicia o ambiente local.
- `build`: executa TypeScript e build Vite.
- `lint`: roda ESLint.
- `preview`: abre uma previa local do build.

## Banco de Dados

O projeto usa Supabase com migracoes versionadas em `supabase/migrations`.

Recursos importantes do banco:

- RLS para controle de acesso.
- Triggers de auditoria.
- Geracao automatica de codigos.
- RPCs para movimentacoes atomicas de estoque.
- RPCs para retiradas concluidas.
- RPCs para inventario individual.
- Funcoes de devolucao, triagem e processamento parcial.
- Buckets e URLs publicas para anexos e imagens.

## Deploy

O projeto esta preparado para Vercel.

O arquivo `vercel.json` usa:

```json
{
  "handle": "filesystem"
}
```

antes do fallback para `index.html`, preservando as rotas `/api/*` e mantendo o roteamento SPA funcionando.

No deploy, configure as mesmas variaveis de ambiente usadas localmente.

### Visao computacional dos veiculos

O diretório `vehicle-cv-service/` contém um serviço FastAPI/OpenCV independente,
com Dockerfile e configurações para Render e Railway. O app primeiro otimiza a
imagem para 1600 px, envia a evidência ao Supabase e chama o serviço Python. A
IA generativa não participa quando ODO e combustível são reconhecidos com
confiança; quando necessária, existe somente uma chamada de fallback.

O usuário pode salvar o registro durante a análise. O registro fica marcado
para revisão e é atualizado quando a leitura termina, sem manter o modal
bloqueado.

O endpoint `GET /v1/markers/{codigo}.png` gera um QR para identificação do
veículo. Para que o marcador também corrija perspectiva, ele deve ser colado em
posição fixa e passar por calibração geométrica com o painel real.

## Qualidade e Manutencao

Pontos importantes para manter o projeto saudavel:

- Rodar `npm run build` antes de publicar.
- Manter `src/types/database.ts` alinhado com o schema real do Supabase.
- Aplicar migracoes no Supabase antes de depender de novas RPCs em producao.
- Evitar alteracoes diretas de estoque fora das funcoes atomicas.
- Preservar historico de retiradas, devolucoes e inventario.
- Testar fluxos de retirada, devolucao e edicao de estoque apos mudancas em schema.
- Conferir variaveis de ambiente da Vercel quando APIs serverless falharem.

## Status

Projeto em evolucao ativa. A base ja cobre os fluxos principais de almoxarifado, mas ainda pode evoluir em testes automatizados, documentacao de migrations, validacoes de permissao e padronizacao visual fina.

## Autor

**Lucas (kacerato)**  
Desenvolvedor junior

Este projeto demonstra pratica com frontend moderno, integracao com Supabase, modelagem de fluxos operacionais, funcoes serverless, relatorios e preocupacoes reais de produto.
