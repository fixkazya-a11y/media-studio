
export type TelegramUser = {
  id: number
  first_name: string
  last_name?: string
  username?: string
  language_code?: string
  is_premium?: boolean
}

type AuthResponse = {
  success: boolean
  user?: TelegramUser
  error?: string
}

declare global {
  interface Window {
    Telegram?: {
      WebApp: {
        initData: string
        initDataUnsafe: {
          user?: TelegramUser
        }
        platform: string
        version: string
        colorScheme: 'light' | 'dark'
        themeParams: Record<string, string>
        ready: () => void
        expand: () => void
        close: () => void
        enableClosingConfirmation: () => void
        disableClosingConfirmation: () => void
        setHeaderColor: (color: string) => void
        setBackgroundColor: (color: string) => void
      }
    }
  }
}

export const telegram = window.Telegram?.WebApp

export const telegramUser = telegram?.initDataUnsafe?.user ?? null

export const isTelegram = Boolean(telegram)

export async function authenticateTelegram(): Promise<TelegramUser | null> {
  if (!telegram?.initData) {
    console.error('Telegram initData отсутствует')
    return null
  }

  try {
    const response = await fetch('/api/telegram', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        initData: telegram.initData,
      }),
    })

    const result = (await response.json()) as AuthResponse

    if (!response.ok || !result.success || !result.user) {
      console.error(
        'Ошибка авторизации Telegram:',
        result.error ?? response.status,
      )
      return null
    }

    console.log('Telegram-пользователь успешно авторизован')
    console.log('Проверенный пользователь:', result.user)

    return result.user
  } catch (error) {
    console.error('Не удалось связаться с сервером авторизации:', error)
    return null
  }
}

export function initializeTelegram() {
  if (!telegram) {
    console.log('Media Studio открыта вне Telegram')
    return
  }

  telegram.ready()
  telegram.expand()

  console.log('Telegram подключён')
  console.log('Версия Telegram:', telegram.version)
  console.log('Платформа:', telegram.platform)
}
