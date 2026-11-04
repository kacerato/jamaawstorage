/*
 * Cores dos graficos Recharts.
 *
 * Recharts recebe cor por prop e por objeto de estilo, nao por classe, entao
 * estes valores nao podem sair do `@theme`. Ficam reunidos aqui para que
 * continuem sendo um lugar so, espelhando os tokens de `src/index.css`.
 */

/* --color-line */
export const CHART_GRID = '#262422'
/* --color-ink-dim */
export const CHART_TICK = '#A09B98'
/* --color-surface */
export const CHART_SURFACE = '#151515'
/* --color-ink */
export const CHART_INK = '#FFFAFA'
/* --color-blaze */
export const CHART_BLAZE = '#FF5D00'

/* Canto vivo: o tooltip nao leva raio, igual ao resto do sistema. */
export const chartTooltipStyle = {
  backgroundColor: CHART_SURFACE,
  border: `1px solid ${CHART_GRID}`,
  color: CHART_INK,
} as const

export const chartTickStyle = { fill: CHART_TICK, fontSize: 12 } as const
export const chartTickStyleSmall = { fill: CHART_TICK, fontSize: 11 } as const
