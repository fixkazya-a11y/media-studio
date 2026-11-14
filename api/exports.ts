
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto'

type ApiRequest = {
  method?: string
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (data: unknown) => void
}

type TelegramUser = {
  id: number
  first_name: string
}

type RequestBody = {
  initData?: unknown
  action?: unknown
  path?: unknown
  fileName?: unknown
  fileSize?: unknown
}

const BUCKET = 'media-exports'
const MAX_SIZE = 19 * 1024 * 1024

function verifyTelegramInitData(
  initData: string,
  botToken: string,
): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData)
    const hash = params.get('hash')

    if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null

    const authDate = Number(params.get('auth_date'))
    const now = Math.floor(Date.now() / 1000)

    if (
      !Number.isFinite(authDate) ||
      authDate > now + 60 ||
      now - authDate > 86400
    ) return null

    const data = [...params.entries()]
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const secret = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest()

    const calculated = createHmac('sha256', secret)
      .update(data)
      .digest()

    const received = Buffer.from(hash, 'hex')

    if (
      received.length !== calculated.length ||
      !timingSafeEqual(received, calculated)
    ) return null

    const rawUser = params.get('user')
    if (!rawUser) return null

    const user = JSON.parse(rawUser) as TelegramUser

    return Number.isSafeInteger(user.id) && user.id > 0
      ? user
      : null
  } catch {
    return null
  }
}

function storagePath(path: string) {
  return path.split('/').map(encodeURIComponent).join('/')
}

export default async function handler(
  req: ApiRequest,
  res: ApiResponse,
) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    })
  }

  const botToken = process.env.EDINSTVO_BOT_TOKEN
  const supabaseUrl = process.env.SUPABASE_URL?.replace(/\/$/, '')
  const supabaseKey = process.env.SUPABASE_SECRET_KEY

  if (!botToken || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      error: 'Не настроены серверные переменные',
    })
  }

  const body = req.body as RequestBody | undefined
  const initData = body?.initData

  if (
    typeof initData !== 'string' ||
    !initData ||
    initData.length > 10000
  ) {
    return res.status(400).json({
      success: false,
      error: 'Некорректная авторизация',
    })
  }

  const user = verifyTelegramInitData(initData, botToken)

  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Открой приложение заново через Telegram',
    })
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  }

  const storageUrl = `${supabaseUrl}/storage/v1`

  try {
    if (body?.action === 'create-upload') {
      const fileSize = body.fileSize

      if (
        typeof fileSize !== 'number' ||
        !Number.isSafeInteger(fileSize) ||
        fileSize <= 0 ||
        fileSize > MAX_SIZE
      ) {
        return res.status(400).json({
          success: false,
          error: 'Для отправки через Telegram пока поддерживаются MP4 до 19 МБ',
        })
      }

      if (
        typeof body.fileName !== 'string' ||
        !/\.mp4$/i.test(body.fileName) ||
        body.fileName.length > 150
      ) {
        return res.status(400).json({
          success: false,
          error: 'Нужен файл MP4',
        })
      }

      const path = `${user.id}/${randomUUID()}.mp4`

      const response = await fetch(
        `${storageUrl}/object/upload/sign/${BUCKET}/${storagePath(path)}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({}),
        },
      )

      const result = await response.json() as {
        url?: string
        error?: string
      }

      if (!response.ok || !result.url) {
        return res.status(502).json({
          success: false,
          error: 'Не удалось подготовить загрузку MP4',
        })
      }

      return res.status(200).json({
        success: true,
        path,
        signedUrl: `${storageUrl}${result.url}`,
        contentType: 'video/mp4',
      })
    }

    if (body?.action === 'send') {
      const path = body.path

      if (
        typeof path !== 'string' ||
        !new RegExp(`^${user.id}/[a-f0-9-]{36}\\.mp4$`, 'i').test(path)
      ) {
        return res.status(400).json({
          success: false,
          error: 'Некорректный путь видео',
        })
      }

      // Убедимся, что файл действительно существует.
      const infoResponse = await fetch(
        `${storageUrl}/object/info/${BUCKET}/${storagePath(path)}`,
        { headers },
      )

      if (!infoResponse.ok) {
        return res.status(404).json({
          success: false,
          error: 'Видео ещё не загружено',
        })
      }

      const info = await infoResponse.json() as {
        size?: number
        metadata?: { size?: number; mimetype?: string }
      }

      const size = info.metadata?.size ?? info.size

      if (
        typeof size !== 'number' ||
        size <= 0 ||
        size > MAX_SIZE ||
        (info.metadata?.mimetype &&
          info.metadata.mimetype !== 'video/mp4')
      ) {
        return res.status(400).json({
          success: false,
          error: 'Видео превышает лимит или имеет неверный формат',
        })
      }

      const signedResponse = await fetch(
        `${storageUrl}/object/sign/${BUCKET}/${storagePath(path)}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({ expiresIn: 3600 }),
        },
      )

      const signed = await signedResponse.json() as {
        signedURL?: string
      }

      if (!signedResponse.ok || !signed.signedURL) {
        throw new Error('Не удалось получить ссылку на видео')
      }

      const videoUrl = `${storageUrl}${signed.signedURL}`

      const telegramResponse = await fetch(
        `https://api.telegram.org/bot${botToken}/sendVideo`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            chat_id: user.id,
            video: videoUrl,
            caption: '🎬 Ваше видео готово!\nЕДИНСТВО | MEDIA STUDIO',
            supports_streaming: true,
          }),
        },
      )

      const telegramResult = await telegramResponse.json() as {
        ok?: boolean
        description?: string
      }

      if (!telegramResponse.ok || !telegramResult.ok) {
        const blocked = /chat not found|bot was blocked|user is deactivated/i
          .test(telegramResult.description || '')

        return res.status(502).json({
          success: false,
          error: blocked
            ? 'Открой личный чат с ботом, нажми Start и повтори отправку'
            : `Telegram не принял видео: ${telegramResult.description || 'неизвестная ошибка'}`,
        })
      }

      return res.status(200).json({
        success: true,
        message: 'Видео отправлено в Telegram',
      })
    }

    return res.status(400).json({
      success: false,
      error: 'Неизвестное действие',
    })
  } catch (error) {
    return res.status(500).json({
      success: false,
      error: error instanceof Error
        ? error.message
        : 'Ошибка отправки видео',
    })
  }
}
