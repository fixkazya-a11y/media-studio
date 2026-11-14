
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

    const receivedHashBuffer = Buffer.from(receivedHash, 'hex')

    if (
      receivedHashBuffer.length !== calculatedHash.length ||
      !timingSafeEqual(receivedHashBuffer, calculatedHash)
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

function isObject(value: unknown): value is Record<string, unknown> {
  return (
    Boolean(value) &&
    typeof value === 'object' &&
    !Array.isArray(value)
  )
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
    id?: unknown
    name?: unknown
    project_type?: unknown
    data?: unknown
    dataPatch?: unknown
  } | undefined

  if (
    typeof body?.initData !== 'string' ||
    body.initData.length === 0 ||
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

  const tableUrl = `${supabaseUrl}/rest/v1/projects`

  try {
    if (body.action === 'get') {
      if (typeof body.id !== 'string' || !body.id) {
        return res.status(400).json({
          success: false,
          error: 'Не указан ID проекта',
        })
      }

      const response = await fetch(
        `${tableUrl}?select=*&id=eq.${encodeURIComponent(body.id)}&telegram_user_id=eq.${user.id}&limit=1`,
        { headers },
      )

      const result = await response.json()

      if (!response.ok) {
        return res.status(500).json({
          success: false,
          error: 'Не удалось загрузить проект',
          details: result,
        })
      }

      if (!Array.isArray(result) || result.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Проект не найден',
        })
      }

      return res.status(200).json({
        success: true,
        project: result[0],
      })
    }

    if (body.action === 'list') {
      const response = await fetch(
        `${tableUrl}?select=*&telegram_user_id=eq.${user.id}&order=updated_at.desc`,
        { headers },
      )

      const result = await response.json()

      if (!response.ok) {
        return res.status(500).json({
          success: false,
          error: 'Не удалось загрузить проекты',
          details: result,
        })
      }

      return res.status(200).json({
        success: true,
        projects: result,
      })
    }

    if (body.action === 'create') {
      const name =
        typeof body.name === 'string' && body.name.trim()
          ? body.name.trim().slice(0, 100)
          : 'Новый проект'

      const projectType =
        typeof body.project_type === 'string'
          ? body.project_type
          : 'karaoke'

      const projectData = isObject(body.data)
        ? body.data
        : {}

      const response = await fetch(tableUrl, {
        method: 'POST',
        headers: {
          ...headers,
          Prefer: 'return=representation',
        },
        body: JSON.stringify({
          telegram_user_id: user.id,
          name,
          project_type: projectType,
          data: projectData,
        }),
      })

      const result = await response.json()

      if (!response.ok) {
        return res.status(500).json({
          success: false,
          error: 'Не удалось создать проект',
          details: result,
        })
      }

      return res.status(201).json({
        success: true,
        project: Array.isArray(result) ? result[0] : result,
      })
    }

    if (body.action === 'update') {
      if (typeof body.id !== 'string' || !body.id) {
        return res.status(400).json({
          success: false,
          error: 'Не указан ID проекта',
        })
      }

      const updates: Record<string, unknown> = {
        updated_at: new Date().toISOString(),
      }

      if (body.name !== undefined) {
        if (
          typeof body.name !== 'string' ||
          !body.name.trim()
        ) {
          return res.status(400).json({
            success: false,
            error: 'Название проекта не может быть пустым',
          })
        }

        updates.name = body.name.trim().slice(0, 100)
      }

      // Частичное обновление отдельных полей data
      if (body.dataPatch !== undefined) {
        if (!isObject(body.dataPatch)) {
          return res.status(400).json({
            success: false,
            error: 'Некорректные частичные данные проекта',
          })
        }

        const currentResponse = await fetch(
          `${tableUrl}?select=data&id=eq.${encodeURIComponent(body.id)}&telegram_user_id=eq.${user.id}&limit=1`,
          { headers },
        )

        const currentResult = await currentResponse.json()

        if (!currentResponse.ok) {
          return res.status(500).json({
            success: false,
            error: 'Не удалось получить текущие данные проекта',
            details: currentResult,
          })
        }

        if (!Array.isArray(currentResult) || currentResult.length === 0) {
          return res.status(404).json({
            success: false,
            error: 'Проект не найден',
          })
        }

        const currentData = isObject(currentResult[0].data)
          ? currentResult[0].data
          : {}

        updates.data = {
          ...currentData,
          ...body.dataPatch,
        }
      } else if (body.data !== undefined) {
        if (!isObject(body.data)) {
          return res.status(400).json({
            success: false,
            error: 'Некорректные данные проекта',
          })
        }

        updates.data = body.data
      }

      if (Object.keys(updates).length === 1) {
        return res.status(400).json({
          success: false,
          error: 'Нет данных для изменения',
        })
      }

      const response = await fetch(
        `${tableUrl}?id=eq.${encodeURIComponent(body.id)}&telegram_user_id=eq.${user.id}`,
        {
          method: 'PATCH',
          headers: {
            ...headers,
            Prefer: 'return=representation',
          },
          body: JSON.stringify(updates),
        },
      )

      const result = await response.json()

      if (!response.ok) {
        return res.status(500).json({
          success: false,
          error: 'Не удалось сохранить изменения',
          details: result,
        })
      }

      if (!Array.isArray(result) || result.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Проект не найден',
        })
      }

      return res.status(200).json({
        success: true,
        project: result[0],
      })
    }

    if (body.action === 'delete') {
      if (typeof body.id !== 'string' || !body.id) {
        return res.status(400).json({
          success: false,
          error: 'Не указан ID проекта',
        })
      }

      const response = await fetch(
        `${tableUrl}?id=eq.${encodeURIComponent(body.id)}&telegram_user_id=eq.${user.id}&select=id`,
        {
          method: 'DELETE',
          headers: {
            ...headers,
            Prefer: 'return=representation',
          },
        },
      )

      const result = await response.json()

      if (!response.ok) {
        return res.status(500).json({
          success: false,
          error: 'Не удалось удалить проект',
          details: result,
        })
      }

      if (!Array.isArray(result) || result.length === 0) {
        return res.status(404).json({
          success: false,
          error: 'Проект не найден',
        })
      }

      return res.status(200).json({
        success: true,
        message: 'Проект удалён',
      })
    }

    return res.status(400).json({
      success: false,
      error: 'Unknown action',
    })
  } catch {
    return res.status(500).json({
      success: false,
      error: 'Ошибка соединения с базой данных',
    })
  }
}
