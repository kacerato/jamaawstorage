import { PackageIcon } from '../icons'
import { cn } from '../../lib/utils'
import alicateImg from '../../assets/alicate.png'
import bolsaImg from '../../assets/bolsa.png'
import botaImg from '../../assets/bota.png'
import capceteImg from '../../assets/capcete.png'
import cintoImg from '../../assets/cinto.png'
import fardamentoImg from '../../assets/fardamento.png'
import marteloImg from '../../assets/martelo.png'
import materialImg from '../../assets/material.png'
import talabarteImg from '../../assets/talabarte.png'

const ITEM_IMAGE_MAP: Record<string, string> = {
  capacete: capceteImg,
  alicate: alicateImg,
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
  material: 'Material',
  fardamento: 'Fardamento',
  bolsa: 'Bolsa',
  bota: 'Bota',
  cinto: 'Cinto',
  talabarte: 'Talabarte',
  martelo: 'Martelo',
  generico: 'Genérico',
}

export function normalizeItemIconKey(iconKey: string | null | undefined): string | null {
  if (!iconKey) return null
  if (iconKey.startsWith('data:image/')) return iconKey
  return iconKey
}

export function itemLabelForKey(iconKey: string | null | undefined): string {
  if (!iconKey) return 'Genérico'
  if (iconKey.startsWith('data:image/')) return 'Foto personalizada'
  return ITEM_LABEL_MAP[iconKey] ?? 'Genérico'
}

export function ItemVisual({
  iconKey,
  size = 36,
  alt,
  className = '',
}: {
  iconKey: string | null | undefined
  size?: number
  alt?: string
  className?: string
}) {
  const normalizedKey = normalizeItemIconKey(iconKey)

  if (normalizedKey?.startsWith('data:image/')) {
    return (
      <img
        src={normalizedKey}
        alt={alt ?? 'Item'}
        style={{ width: size, height: size, objectFit: 'cover' }}
        className={cn('rounded-lg', className)}
        draggable={false}
      />
    )
  }

  const image = normalizedKey ? ITEM_IMAGE_MAP[normalizedKey] : null
  if (image) {
    return (
      <img
        src={image}
        alt={alt ?? itemLabelForKey(normalizedKey)}
        style={{ width: size, height: size, objectFit: 'contain' }}
        className={cn('max-h-full max-w-full', className)}
        draggable={false}
      />
    )
  }

  return <PackageIcon size={Math.round(size * 0.7)} className={className} />
}
