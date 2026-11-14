
import { createHmac, timingSafeEqual } from 'node:crypto'

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
  last_name?: string
  username?: string
  language_code?: string
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

    if (!Number.isFinite(authDate)) {
      return null
    }

    const now = Math.floor(Date.now() / 1000)

    if (authDate > now + 60 || now - authDate > 86400) {
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

export default function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      success: false,
      error: 'Method not allowed',
    })
  }

  const botToken = process.env.EDINSTVO_BOT_TOKEN

  if (!botToken) {
    return res.status(500).json({
      success: false,
      error: 'Server configuration error',
    })
  }

  const body = req.body as { initData?: unknown } | undefined
  const initData = body?.initData

  if (typeof initData !== 'string' || initData.length === 0 || initData.length > 10000) {
    return res.status(400).json({
      success: false,
      error: 'Invalid initData',
    })
  }

  const user = verifyTelegramInitData(initData, botToken)

  if (!user) {
    return res.status(401).json({
      success: false,
      error: 'Telegram authentication failed',
    })
  }

  return res.status(200).json({
    success: true,
    user,
  })
}
