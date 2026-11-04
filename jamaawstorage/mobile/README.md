# Jamaaw Almoxarifado — app do supervisor

App nativo (React Native + Expo) com três telas: **Consumo**, **Estoque** e
**Carros**. Lê os mesmos dados do painel web, no mesmo projeto Supabase.

Somente leitura. Cadastro, retirada, devolução, triagem e kit continuam no
painel web — ver [`../app`](../app).

## Rodar no celular

```bash
cd jamaawstorage/mobile
npm install
```

```bash
npx expo start
```

Abra o **Expo Go** no celular e escaneie o QR code que aparece no terminal.
O celular e o computador precisam estar na mesma rede. Se a rede bloquear a
conexão direta (Wi-Fi de empresa costuma bloquear), use túnel:

```bash
npx expo start --tunnel
```

As credenciais ficam em `.env`, que não vai para o git. Copie de
`.env.example` e preencha com a URL e a anon key do projeto Supabase — as
mesmas que o web usa.

Login: as contas de supervisor que já existem. Não há criação de conta aqui.
A sessão fica guardada no keystore do aparelho, então a senha é pedida
uma vez.

## O que cada tela faz

### Consumo

Duas abas:

- **Repor** — o que comprar agora. Para cada item: quanto comprar, quanto
  tem em estoque e em quanto tempo cruza o mínimo. Ordenado por urgência:
  zerado e abaixo do mínimo primeiro.
- **Saindo** — saída líquida dos últimos 90 dias, por volume. Responde
  "para onde está indo o material".

Tocar em um item abre o detalhe: saldo, mínimo, quanto saiu, quanto voltou,
e a leitura honesta do número.

**Como a previsão é calculada.** Consumo líquido = saídas − (devoluções
triadas + estornos), na janela de 90 dias. Os eventos `received` e `triage`
têm delta zero por construção no banco — o estoque só é creditado no fim do
fluxo de devolução — então não entram na conta.

Cada item cai em uma de quatro classes:

| Classe | Critério | Previsão de ruptura |
|---|---|---|
| Consumível | devolução ≤ 5%, ≥ 3 dias de saída, ≥ 2 un | sim |
| Circula e volta | devolução > 5% | não se aplica |
| Histórico curto | < 3 dias de saída na janela | não |
| Sem saída | zero saídas na janela | não |

As três últimas classes **não recebem previsão de propósito**. Alicate,
cinto e bota voltam entre 7% e 40% do que sai: para esses, "quando vai
acabar" é a pergunta errada, o item circula. E item que saiu em um único dia
em 90 não tem ritmo que se possa estimar.

**Por que 90 dias e não 30.** Houve uma devolução em massa em 03/11/2026. Em
janela de 30 dias, 12 itens ficam com consumo líquido negativo — previsão
sobre isso seria lixo. Em 90 dias os mesmos itens voltam a números
plausíveis.

**Precisão medida.** Backtest contra os 90 dias seguintes: consumível de alto
volume erra menos de 10%; item de baixo volume oscila até 70%. Por isso a
tela mostra sempre a taxa ao lado do horizonte, e o horizonte em faixa
("~3 semanas"), nunca uma data exata com ar de precisão que ela não tem.

### Estoque

Lista dos itens ativos com saldo e mínimo. Busca por nome ou código, e
filtros para **abaixo do mínimo** e **zerados**. Tocar no item abre a
separação por condição: novo, usado, danificado.

### Carros

Por veículo: quilometragem atual, nível de combustível, último registro e a
lista de alertas de manutenção com o estado de cada um.

- **Vencida** — passou da data ou do km alvo.
- **Próxima** — entrou na antecedência configurada (`advance_days` /
  `advance_km`).
- **Em dia** — ainda fora da antecedência.

A regra é a mesma do painel web, portada de `VehiclesPage.tsx`: o app não
pode discordar do site sobre o que está vencido.

A quilometragem atual é a **maior** leitura registrada, não a mais recente.
Um lançamento fora de ordem — o supervisor registra hoje uma leitura de
ontem — não deve fazer o km do carro "voltar" e marcar alertas vencidos
como em dia de novo.

## Offline e sinal ruim

O app é usado no pátio e na obra. Toda tela:

1. Mostra o que está salvo no aparelho, imediatamente, marcado com a hora
   da coleta ("atualizado há 5 min").
2. Busca o dado novo em segundo plano.
3. Se a busca falhar, **mantém o que está na tela** e avisa que está
   defasado ("salvo ontem", em amarelo).

Nenhuma tela fica em branco se já houve uma coleta bem-sucedida. Puxar a
tela para baixo tenta de novo.

O tempo limite de requisição é 20 segundos, menor que os 45 do web: no
celular é melhor saber que falhou do que esperar.

## Notificação

**O que está ativo: lembrete local.** Quando o app abre e encontra alerta
vencido ou próximo, agenda um aviso diário às 7h no próprio aparelho. Não
precisa de servidor nem de build na nuvem, e funciona no Expo Go. O botão
"Ativar avisos" na tela de Carros pede a permissão.

**O limite, que é real:** o lembrete só é agendado quando o app roda. Um
alerta que vencer depois da última vez que você abriu o app não gera aviso
até você abrir de novo.

**Push remoto está escrito e pronto, mas não ativado.** O código está em
`supabase/functions/notify-maintenance/` e a tabela de tokens em
`supabase/migrations/001_push_tokens.sql` (não aplicada).

O que falta, em ordem:

1. Aplicar a migration `001_push_tokens.sql`. **Antes disso, confirme com a
   sessão de hierarquia de supervisores** — ela está mexendo nas políticas
   RLS, e a política da tabela assume o modelo atual.
2. Fazer o app registrar o token (`getExpoPushTokenAsync`) em `push_tokens`.
3. Build próprio do app: `npx eas build -p android --profile preview`.
4. `npx supabase functions deploy notify-maintenance` e definir
   `NOTIFY_SECRET`.
5. Agendar: `pg_cron` chamando a função 1x/dia, ou um job no Railway.

O passo 3 é o que trava hoje: **push remoto não funciona no Expo Go**, o app
precisa de um build com credencial de notificação (FCM no Android). Isso é
limite da plataforma, não da função. A função é idempotente por dia e remove
token inválido sozinha.

## O que o app deliberadamente NÃO faz

Três telas é o limite acordado, não um ponto de partida. O app não tem:

- **Registro de quilometragem ou abastecimento.** Consulta apenas. Lançar km
  e abastecimento é escrita no banco e fica no painel web.
- **Cadastro de alerta de manutenção.** A tela do web que faz isso tem ~1480
  linhas; portá-la seria trocar três telas boas por seis pela metade.
- **Retirada, devolução e triagem.** O fluxo tem quatro etapas, assinatura e
  PDF. Não cabe em uma mão no celular.
- **Pessoas, obras e kits.** Fora das três telas.
- **Gráfico.** Em tela de celular, com uma mão, número e faixa de severidade
  decidem mais rápido do que gráfico.

## Abertura e marca

A tela de abertura anima a logo: o símbolo do Jamaaw é uma pilha de sete
ondas, e elas entram em cascata de baixo para cima, as três laranja por
último — o olho termina no topo, na cor da marca. O nome entra depois que a
pilha fecha. Cerca de 1,2 segundo ao todo.

**É SVG animado, não GIF.** A marca foi reconstruída em vetor
([`src/components/BrandMark.tsx`](src/components/BrandMark.tsx)) a partir do
`logojamaaw.png` do site, que tem 2048×2048 e 1,3 MB. Três motivos:

1. Fica nítida em qualquer densidade de tela, sem gerar `@2x`/`@3x`.
2. Pesa poucos KB no bundle em vez de 1,3 MB.
3. **Cada onda é um elemento próprio, animável em separado.** Com um GIF ou
   PNG a marca seria uma imagem só, e a única animação possível seria mover
   o retângulo inteiro.

A animação usa a Animated API da React Native com `useNativeDriver`, não
Reanimated: são sete valores interpolados em paralelo, carga trivial.

`expo-splash-screen` segura a splash nativa até as fontes carregarem, para
não piscar branco entre ela e a animação. Como a sequência leva ~1,2s, a
verificação da sessão e o carregamento das fontes acontecem por trás dela em
vez de virar espera adicional.

## Identidade visual

Os tokens são os mesmos do site, portados de `app/src/index.css` para
[`src/theme/tokens.ts`](src/theme/tokens.ts). As regras de
`app/src/components/ui/TOKENS.md` valem aqui:

- **Canto vivo.** Nenhum raio, com duas exceções: ponto de status e avatar.
- **Uma superfície só.** `surface` nunca dentro de `surface`; divide-se com
  linha de 1px.
- **Laranja se toca ou para.** Preenchido, em ação primária e aba ativa.
  Nunca em texto, borda ou ícone decorativo.
- **Severidade pela faixa.** Faixa lateral de 2px sobre fundo `void`, não
  fundo tingido.
- **44px de alvo de toque** em tudo que é clicável.
- **Estado tinge o número, não a caixa.**

Fontes via `expo-font`: Archivo (título), Inter (texto), JetBrains Mono
(número, tabular).

Nada de subtítulo que só parafraseia o título da tela. Onde há uma segunda
linha no cabeçalho, ela traz número.

## Estrutura

```
src/
  theme/tokens.ts          cores, fontes, espaço, alvo de toque
  lib/
    env.ts                 credenciais via EXPO_PUBLIC_*
    secureStorage.ts       sessão no keystore do aparelho
    supabase.ts            cliente, timeout, ciclo de refresh
    notifications.ts       lembrete local de manutenção
  data/
    database.types.ts      subconjunto do schema (5 de 26 tabelas)
    queries.ts             consultas, todas somente leitura
    consumption.ts         consumo, classificação e previsão
    maintenance.ts         estado de alerta, portado do web
    useCachedQuery.ts      cache em disco + atualização em segundo plano
  auth/AuthContext.tsx     login, permissão de supervisor
  components/              primitivas do sistema visual
  screens/                 as três telas + login
supabase/
  functions/               Edge Function de push (pronta, não ativada)
  migrations/              tabela de tokens (não aplicada)
```

### Sobre `database.types.ts`

É escrito à mão de propósito. O tipo completo gerado pelo Supabase tem ~80KB
e cobre 26 tabelas; o app lê 5. Manter o arquivo inteiro tornaria cada
mudança de schema um merge grande por nada.

Se o schema mudar, gere os tipos e traga à mão as colunas dessas tabelas:

```bash
npx supabase gen types typescript --project-id syslxrzvfvdpoiwbpyjd
```

### Sobre `consumption.ts`

Isolado de propósito. A sessão de relatórios do web calcula o mesmo consumo;
se aquela regra virar um pacote compartilhado, troca-se este arquivo inteiro
sem tocar nas telas.

## Verificar

```bash
npx tsc --noEmit
```
