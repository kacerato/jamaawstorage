export function cn(...classes: (string | boolean | undefined | null)[]): string {
  return classes.filter(Boolean).join(' ')
}

export function formatDateTime(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export function formatDate(dateString: string): string {
  const date = new Date(dateString)
  return date.toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  })
}

export function generateWithdrawalCodePreview(): string {
  const now = new Date()
  const dateStr =
    now.getFullYear().toString() +
    (now.getMonth() + 1).toString().padStart(2, '0') +
    now.getDate().toString().padStart(2, '0')
  return `RET-${dateStr}-???`
}

export function isValidUUID(uuid: string): boolean {
  const uuidRegex =
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
  return uuidRegex.test(uuid)
}

export function formatQuantity(quantity: number, unit: string): string {
  return `${quantity} ${unit}`
}

export const DEFAULT_IMAGE_UPLOAD_OPTIONS = {
  maxFileSizeMb: 12,
  maxDimension: 2200,
  quality: 0.86,
} as const

export async function imageFileToDataUrl(
  file: File,
  options?: {
    maxFileSizeMb?: number
    maxDimension?: number
    quality?: number
  }
): Promise<string> {
  const maxFileSizeMb = options?.maxFileSizeMb ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.maxFileSizeMb
  const maxDimension = options?.maxDimension ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.maxDimension
  const quality = options?.quality ?? DEFAULT_IMAGE_UPLOAD_OPTIONS.quality

  if (!file.type.startsWith('image/')) {
    throw new Error('Selecione uma imagem válida.')
  }

  if (file.size > maxFileSizeMb * 1024 * 1024) {
    throw new Error(`A imagem deve ter no máximo ${maxFileSizeMb} MB.`)
  }

  return new Promise((resolve, reject) => {
    const image = new Image()
    const url = URL.createObjectURL(file)

    image.onload = () => {
      let width = image.width
      let height = image.height

      if (width > maxDimension || height > maxDimension) {
        const ratio = Math.min(maxDimension / width, maxDimension / height)
        width = Math.round(width * ratio)
        height = Math.round(height * ratio)
      }

      const canvas = document.createElement('canvas')
      canvas.width = width
      canvas.height = height
      const ctx = canvas.getContext('2d')
      if (!ctx) {
        URL.revokeObjectURL(url)
        reject(new Error('Não foi possível processar a imagem.'))
        return
      }

      ctx.drawImage(image, 0, 0, width, height)
      URL.revokeObjectURL(url)
      resolve(canvas.toDataURL('image/jpeg', quality))
    }

    image.onerror = () => {
      URL.revokeObjectURL(url)
      reject(new Error('Não foi possível ler a imagem.'))
    }

    image.src = url
  })
}
