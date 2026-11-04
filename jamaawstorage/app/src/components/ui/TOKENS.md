# Identidade visual

Os tokens vivem em `src/index.css`, dentro de `@theme`, então o Tailwind 4
os expõe como utilitário (`bg-surface`, `text-ink`, `border-line`…).

**Toda a `src/` já está migrada.** Não há mais `orange-*`, `gray-*`,
`backdrop-blur`, gradiente ou hex escrito à mão. Este guia serve para manter
o padrão em código novo. Referência: `src/pages/dashboard/DashboardPage.tsx`.

## De → para

| Antigo | Novo |
|---|---|
| `bg-gray-950`, `bg-[#0f1115]`, gradiente de fundo | `bg-void` |
| `bg-gray-900`, `bg-gray-800`, `bg-white/4..10` | `bg-surface` |
| `border-gray-700`, `border-white/8..12` | `border-line` |
| `text-white` | `text-ink` |
| `text-gray-300`, `text-gray-400`, `text-white/62` | `text-ink-dim` |
| `text-gray-500`, `text-gray-600`, `text-white/45` | `text-ink-mute` |
| `bg-orange-500`, `text-orange-*`, `border-orange-*` | `bg-blaze` + `text-blaze-ink` |
| `text-emerald-*` | `text-ok` |
| `text-amber-*` | `text-warn` |
| `text-red-*` | `text-crit` |
| `rounded-lg/xl/2xl/3xl/full/[22px]` | remover (canto vivo) |
| `backdrop-blur*`, `shadow-*`, gradientes | remover |
| rótulo em caixa alta | classe `label-mono` |
| número de destaque | classe `num` |

## Regras

1. **Canto vivo.** Nenhum `rounded-*`. A única exceção aceita até agora é o
   miolo do donut, que é circular por estar dentro de um anel.
2. **Uma superfície só.** `bg-surface` nunca dentro de `bg-surface`. Dentro de
   um bloco, separe com `border-line`, não com um segundo fundo.
3. **Laranja se toca ou para.** `bg-blaze` preenchido, só em ação primária e
   estado crítico. Nunca em texto, borda, ícone decorativo ou `focus:ring`.
4. **Severidade pela faixa.** Alerta e linha de alerta usam
   `border-l-2 border-l-{crit,warn,ok}` sobre `bg-void`, não fundo tingido.
5. **44px de alvo.** Todo clicável leva `min-h-touch`.
6. **Estado tinge o número, não a caixa.** Ver `MiniMetric` e `StatCard`.

## Armadilhas

**Grid aninhado.** Coluna de grid que recebe um filho com borda precisa de
`min-w-0` **e** `grid-cols-1` quando ela própria é grid; sem isso a trilha
interna guarda a largura intrínseca do conteúdo e estoura a página em alguns
pixels. Foi o que aconteceu com o `<aside>` do Dashboard.

**Fundo tingido precisa de alfa.** `bg-warn text-warn` é texto invisível.
Pastilha de estado é `bg-warn/15 text-warn`; o token cheio (`bg-warn`) só
serve para barra de progresso e ponto de status.

**`rounded-full`.** Fica só onde é círculo de verdade: avatar e ponto de
status. Pastilha com `px-*` é quadrada, igual ao `Badge`. A única exceção de
raio no sistema é o miolo do donut do Dashboard, por estar dentro de um anel.

## Como conferir

O app não sobe sem `VITE_SUPABASE_URL` e `VITE_SUPABASE_ANON_KEY`. Para olhar
uma página sem banco, suba um vite com um plugin `resolveId` que troque
`lib/supabase` por um stub de fixtures, e monte a página em um html próprio.
Depois confira no console da página:

```js
const d = document.documentElement
d.scrollWidth > d.clientWidth            // precisa ser false, em 375px também
[...document.querySelectorAll('button')]
  .filter(b => b.getBoundingClientRect().height < 44)  // precisa ser vazio
```
