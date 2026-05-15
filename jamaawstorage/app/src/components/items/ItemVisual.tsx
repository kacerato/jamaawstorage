import { PackageIcon } from '../icons'
import { cn } from '../../lib/utils'
import { ITEM_IMAGE_MAP, itemLabelForKey, normalizeItemIconKey } from './itemVisualData'

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
