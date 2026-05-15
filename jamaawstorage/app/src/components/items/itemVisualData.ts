import alicateImg from '../../assets/alicate.png'
import balaclavaImg from '../../assets/balaclava.png'
import bolsaImg from '../../assets/bolsa.png'
import botaImg from '../../assets/bota.png'
import capceteImg from '../../assets/capcete.png'
import chaveCatracaImg from '../../assets/chavecatraca.png'
import cintoImg from '../../assets/cinto.png'
import fardamentoImg from '../../assets/fardamento.png'
import luvasImg from '../../assets/luvas.png'
import marteloImg from '../../assets/martelo.png'
import materialImg from '../../assets/material.png'
import oculosImg from '../../assets/oculos.png'
import talabarteImg from '../../assets/talabarte.png'

export const ITEM_IMAGE_MAP: Record<string, string> = {
  capacete: capceteImg,
  alicate: alicateImg,
  oculos: oculosImg,
  luvas: luvasImg,
  chavecatraca: chaveCatracaImg,
  balaclava: balaclavaImg,
  material: materialImg,
  fardamento: fardamentoImg,
  bolsa: bolsaImg,
  bota: botaImg,
  cinto: cintoImg,
  talabarte: talabarteImg,
  martelo: marteloImg,
  helmet: capceteImg,
  pliers: alicateImg,
  vest: fardamentoImg,
}

const ITEM_LABEL_MAP: Record<string, string> = {
  capacete: 'Capacete',
  alicate: 'Alicate',
  oculos: 'Oculos',
  luvas: 'Luvas',
  chavecatraca: 'Chave catraca',
  balaclava: 'Balaclava',
  material: 'Material',
  fardamento: 'Fardamento',
  bolsa: 'Bolsa',
  bota: 'Bota',
  cinto: 'Cinto',
  talabarte: 'Talabarte',
  martelo: 'Martelo',
  generico: 'Generico',
}

if (typeof window !== 'undefined') {
  Object.values(ITEM_IMAGE_MAP).forEach((src) => {
    const img = new Image()
    img.src = src
  })
}

export function normalizeItemIconKey(iconKey: string | null | undefined): string | null {
  if (!iconKey) return null
  if (iconKey.startsWith('data:image/')) return iconKey
  return iconKey
}

export function itemLabelForKey(iconKey: string | null | undefined): string {
  if (!iconKey) return 'Generico'
  if (iconKey.startsWith('data:image/')) return 'Foto personalizada'
  return ITEM_LABEL_MAP[iconKey] ?? 'Generico'
}
