
import { createHmac, timingSafeEqual } from 'node:crypto'

type TelegramUser = {
  id: number
  first_name: string
  last_name?: string
  username?: string
}

type ApiRequest = {
  method?: string
  body?: unknown
}

type ApiResponse = {
  status: (code: number) => ApiResponse
  json: (data: unknown) => void
}

type SupabaseResponse = {
  url?: string
  signedURL?: string
  message?: string
  error?: string
}

function verifyTelegramInitData(
  initData: string,
  botToken: string,
): TelegramUser | null {
  try {
    const params = new URLSearchParams(initData)
    const receivedHash = params.get('hash')

    if (!receivedHash || !/^[a-f0-9]{64}$/i.test(receivedHash)) {
      return null
    }

    const authDate = Number(params.get('auth_date'))
    const now = Math.floor(Date.now() / 1000)

    if (
      !Number.isFinite(authDate) ||
      authDate > now + 60 ||
      now - authDate > 86400
    ) {
      return null
    }

    const entries = [...params.entries()]
      .filter(([key]) => key !== 'hash')
      .sort(([a], [b]) => a.localeCompare(b))

    const dataCheckString = entries
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    const secretKey = createHmac('sha256', 'WebAppData')
      .update(botToken)
      .digest()

    const calculatedHash = createHmac('sha256', secretKey)
      .update(dataCheckString)
      .digest()

    const receivedBuffer = Buffer.from(receivedHash, 'hex')

    if (
      receivedBuffer.length !== calculatedHash.length ||
      !timingSafeEqual(receivedBuffer, calculatedHash)
    ) {
      return null
    }

    const userData = params.get('user')

    if (!userData) return null

    const user = JSON.parse(userData) as TelegramUser

    if (
      !Number.isSafeInteger(user.id) ||
      user.id <= 0 ||
      typeof user.first_name !== 'string'
    ) {
      return null
    }

    return user
  } catch {
    return null
  }
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
  const supabaseUrl = process.env.SUPABASE_URL
  const supabaseKey = process.env.SUPABASE_SECRET_KEY

  if (!botToken || !supabaseUrl || !supabaseKey) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration error',
    })
  }

  const body = req.body as {
    initData?: unknown
    action?: unknown
    projectId?: unknown
    fileName?: unknown
    path?: unknown
  } | undefined

  if (
    typeof body?.initData !== 'string' ||
    !body.initData ||
    body.initData.length > 10000
  ) {
    return res.status(400).json({
      success: false,
      error: 'Invalid initData',
    })
  }

  const user = verifyTelegramInitData(body.initData, botToken)

  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Telegram authentication failed',
    })
  }

  const headers = {
    apikey: supabaseKey,
    Authorization: `Bearer ${supabaseKey}`,
    'Content-Type': 'application/json',
  }

  const projectId = body.projectId

  if (typeof projectId !== 'string' || !projectId) {
    return res.status(400).json({
      success: false,
      error: 'Не указан ID проекта',
    })
  }

  const tableUrl = `${supabaseUrl}/rest/v1/projects`

  try {
    // Проверяем, что проект принадлежит пользователю
    const projectResponse = await fetch(
      `${tableUrl}?select=id&id=eq.${encodeURIComponent(projectId)}&telegram_user_id=eq.${user.id}&limit=1`,
      { headers },
    )

    const projects = await projectResponse.json() as Array<{ id: string }>

    if (!projectResponse.ok) {
      return res.status(500).json({
        success: false,
        error: 'Не удалось проверить проект',
      })
    }

    if (!Array.isArray(projects) || projects.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Проект не найден',
      })
    }

    const storageUrl = `${supabaseUrl}/storage/v1`
    const bucket = 'media-audio'

    // Создание временной ссылки для загрузки
    if (body.action === 'create-upload') {
      if (
        typeof body.fileName !== 'string' ||
        !/\.(mp3|wav)$/i.test(body.fileName) ||
        body.fileName.length > 150
      ) {
        return res.status(400).json({
          success: false,
          error: 'Поддерживаются только MP3 и WAV',
        })
      }

      const extension = body.fileName.toLowerCase().endsWith('.wav')
        ? 'wav'
        : 'mp3'

      const path = `${user.id}/${projectId}/audio.${extension}`

      const response = await fetch(
        `${storageUrl}/object/upload/sign/${bucket}/${path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        {
          method: 'POST',
          headers: {
            ...headers,
            'x-upsert': 'true',
          },
          body: JSON.stringify({}),
        },
      )

      const result = await response.json() as SupabaseResponse

      if (!response.ok || typeof result.url !== 'string') {
        return res.status(500).json({
          success: false,
          error: 'Не удалось создать ссылку для загрузки',
          details: result,
        })
      }

      return res.status(200).json({
        success: true,
        path,
        signedUrl: `${storageUrl}${result.url}`,
        contentType:
          extension === 'wav' ? 'audio/wav' : 'audio/mpeg',
      })
    }

    // Создание временной ссылки для прослушивания
    if (body.action === 'create-download') {
      if (
        typeof body.path !== 'string' ||
        !body.path.startsWith(`${user.id}/${projectId}/`) ||
        !/^audio\.(mp3|wav)$/.test(body.path.split('/').pop() || '')
      ) {
        return res.status(400).json({
          success: false,
          error: 'Некорректный путь к аудио',
        })
      }

      const response = await fetch(
        `${storageUrl}/object/sign/${bucket}/${body.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        {
          method: 'POST',
          headers,
          body: JSON.stringify({
            expiresIn: 3600,
          }),
        },
      )

      const result = await response.json() as SupabaseResponse

      if (!response.ok || typeof result.signedURL !== 'string') {
        return res.status(500).json({
          success: false,
          error: 'Не удалось получить аудиофайл',
          details: result,
        })
      }

      return res.status(200).json({
        success: true,
        signedUrl: `${supabaseUrl}/storage/v1${result.signedURL}`,
      })
    }

    // Удаление аудиофайла
    if (body.action === 'delete') {
      if (
        typeof body.path !== 'string' ||
        !body.path.startsWith(`${user.id}/${projectId}/`) ||
        !/^audio\.(mp3|wav)$/.test(body.path.split('/').pop() || '')
      ) {
        return res.status(400).json({
          success: false,
          error: 'Некорректный путь к аудио',
        })
      }

      const response = await fetch(
        `${storageUrl}/object/${bucket}/${body.path
          .split('/')
          .map(encodeURIComponent)
          .join('/')}`,
        {
          method: 'DELETE',
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
          },
        },
      )

      if (!response.ok) {
        const details = await response.text()

        return res.status(500).json({
          success: false,
          error: 'Не удалось удалить аудио',
          details,
        })
      }

      return res.status(200).json({
        success: true,
        message: 'Аудиофайл удалён',
      })
    }

    return res.status(400).json({
      success: false,
      error: 'Неизвестное действие',
    })
  } catch (err) {
    return res.status(500).json({
      success: false,
      error: 'Ошибка работы с облачным хранилищем',
      details: err instanceof Error ? err.message : 'Неизвестная ошибка',
    })
  }
}
