
import {
  createContext,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'

import {
  authenticateTelegram,
  type TelegramUser,
} from './telegram'

type TelegramAuthContextType = {
  user: TelegramUser | null
  loading: boolean
  isAuthenticated: boolean
}

const TelegramAuthContext = createContext<TelegramAuthContextType>({
  user: null,
  loading: true,
  isAuthenticated: false,
})

export function TelegramAuthProvider({
  children,
}: {
  children: ReactNode
}) {
  const isLocalDev = import.meta.env.DEV

  const [user, setUser] = useState<TelegramUser | null>(
    isLocalDev
      ? {
          id: 999999999,
          first_name: 'Local',
          username: 'local_dev',
        }
      : null,
  )

  const [loading, setLoading] = useState(!isLocalDev)
  const started = useRef(false)

  useEffect(() => {
    if (isLocalDev || started.current) return

    started.current = true

    authenticateTelegram()
      .then((authenticatedUser) => {
        setUser(authenticatedUser)
      })
      .finally(() => {
        setLoading(false)
      })
  }, [isLocalDev])

  return (
    <TelegramAuthContext.Provider
      value={{
        user,
        loading,
        isAuthenticated: user !== null,
      }}
    >
      {children}
    </TelegramAuthContext.Provider>
  )
}

export function useTelegramAuth() {
  return useContext(TelegramAuthContext)
}
