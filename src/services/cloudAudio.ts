
import { telegram } from '../telegram/telegram'

type ApiResponse<T> = {
  success?: boolean
  error?: string
  details?: unknown
} & T

async function request<T>(
  body: Record<string, unknown>,
): Promise<T> {
  if (!telegram?.initData) {
    throw new Error('Открой Media Studio через Telegram')
  }

  const response = await fetch('/api/audio', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...body,
      initData: telegram.initData,
    }),
  })

  const result = await response.json() as ApiResponse<T>

  if (!response.ok || !result.success) {
    const details = result.details
      ? JSON.stringify(result.details)
      : ''

    throw new Error(
      [result.error || 'Ошибка сервера', details]
        .filter(Boolean)
        .join(': '),
    )
  }

  return result
}

// Получение ссылки для загрузки
export async function createAudioUpload(
  projectId: string,
  fileName: string,
) {
  return request<{
    path: string
    signedUrl: string
    contentType: string
  }>({
    action: 'create-upload',
    projectId,
    fileName,
  })
}

// Загрузка файла напрямую в Supabase
export async function uploadAudioFile(
  signedUrl: string,
  file: File,
  contentType: string,
) {
  const response = await fetch(signedUrl, {
    method: 'PUT',
    headers: {
      'Content-Type': contentType,
    },
    body: file,
  })

  if (!response.ok) {
    throw new Error('Не удалось загрузить аудио в облако')
  }
}

// Получение ссылки для прослушивания
export async function getAudioDownloadUrl(
  projectId: string,
  path: string,
) {
  const result = await request<{
    signedUrl: string
  }>({
    action: 'create-download',
    projectId,
    path,
  })

  return result.signedUrl
}

// Удаление аудио из облака
export async function deleteCloudAudio(
  projectId: string,
  path: string,
) {
  return request<{
    message: string
  }>({
    action: 'delete',
    projectId,
    path,
  })
}
