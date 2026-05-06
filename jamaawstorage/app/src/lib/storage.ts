import { supabase } from './supabase'
import {
  DEFAULT_IMAGE_UPLOAD_OPTIONS,
  optimizeImageFileToJpegBlob,
} from './utils'

const FILE_BUCKET = 'app-files'

function buildFilePath(scope: string, entityId: string, extension = 'jpg'): string {
  const safeScope = scope.replace(/[^a-z0-9/_-]/gi, '-').toLowerCase()
  const safeEntity = entityId.replace(/[^a-z0-9_-]/gi, '-').toLowerCase()
  const uniqueSuffix =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
  return `${safeScope}/${safeEntity}/${Date.now()}-${uniqueSuffix}.${extension}`
}

function getSupabaseProjectUrl(): string {
  const url = import.meta.env.VITE_SUPABASE_URL
  if (!url) {
    throw new Error('VITE_SUPABASE_URL nao configurada.')
  }

  return url.replace(/\/$/, '')
}

function inferExtension(fileName: string, fallback: string): string {
  const ext = fileName.split('.').pop()?.trim().toLowerCase()
  return ext && ext.length <= 8 ? ext : fallback
}

function dataUrlToBlob(dataUrl: string): Blob {
  const match = dataUrl.match(/^data:(.+?);base64,(.+)$/)
  if (!match) {
    throw new Error('Conteudo de assinatura invalido.')
  }

  const [, mimeType, base64] = match
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i)
  }

  return new Blob([bytes], { type: mimeType })
}

async function uploadBlob({
  blob,
  contentType,
  scope,
  entityId,
  extension,
}: {
  blob: Blob
  contentType: string
  scope: string
  entityId: string
  extension: string
}): Promise<string> {
  const filePath = buildFilePath(scope, entityId, extension)

  const { error: uploadError } = await supabase.storage
    .from(FILE_BUCKET)
    .upload(filePath, blob, {
      cacheControl: '3600',
      contentType,
      upsert: true,
    })

  if (uploadError) {
    throw new Error(uploadError.message)
  }

  return buildPublicStorageUrl(filePath)
}

export function buildPublicStorageUrl(pathOrUrl: string): string {
  const projectUrl = getSupabaseProjectUrl()

  if (/^https?:\/\//i.test(pathOrUrl)) {
    if (pathOrUrl.includes('/storage/v1/object/public/')) {
      return pathOrUrl
    }

    if (pathOrUrl.includes(`/storage/v1/object/${FILE_BUCKET}/`)) {
      return pathOrUrl.replace('/storage/v1/object/', '/storage/v1/object/public/')
    }

    return pathOrUrl
  }

  const normalizedPath = pathOrUrl.replace(/^\/+/, '')
  return `${projectUrl}/storage/v1/object/public/${FILE_BUCKET}/${normalizedPath}`
}

export async function uploadImageToStorage({
  file,
  scope,
  entityId,
  options = DEFAULT_IMAGE_UPLOAD_OPTIONS,
}: {
  file: File
  scope: string
  entityId: string
  options?: {
    maxFileSizeMb?: number
    maxDimension?: number
    quality?: number
  }
}): Promise<string> {
  const optimizedBlob = await optimizeImageFileToJpegBlob(file, options)
  return uploadBlob({
    blob: optimizedBlob,
    contentType: 'image/jpeg',
    scope,
    entityId,
    extension: 'jpg',
  })
}

export async function uploadFileToStorage({
  file,
  scope,
  entityId,
}: {
  file: File
  scope: string
  entityId: string
}): Promise<string> {
  return uploadBlob({
    blob: file,
    contentType: file.type || 'application/octet-stream',
    scope,
    entityId,
    extension: inferExtension(file.name, 'bin'),
  })
}

export async function uploadDataUrlToStorage({
  dataUrl,
  scope,
  entityId,
  extension = 'png',
}: {
  dataUrl: string
  scope: string
  entityId: string
  extension?: string
}): Promise<string> {
  const blob = dataUrlToBlob(dataUrl)
  return uploadBlob({
    blob,
    contentType: blob.type || 'image/png',
    scope,
    entityId,
    extension,
  })
}
