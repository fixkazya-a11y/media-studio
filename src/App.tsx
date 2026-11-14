
import {
  BrowserRouter,
  Routes,
  Route,
  Link,
} from 'react-router-dom'

import StudioShell from './components/StudioShell'
import './App.css'

import Home from './pages/Home'
import Sounds from './pages/Sounds'
import Edits from './pages/Edits'
import Content from './pages/Content'
import Templates from './pages/Templates'
import Settings from './pages/Settings'
import Project from './pages/Project'
import Video from './pages/Video'

import {
  TelegramAuthProvider,
  useTelegramAuth,
} from './telegram/TelegramAuthContext'

function AppContent() {
  const { loading, user, isAuthenticated } =
    useTelegramAuth()

  const isLocalDev = import.meta.env.DEV

  // Проверяем наличие данных авторизации Telegram.
  // В обычном браузере initData отсутствует.
  const hasTelegramSession = Boolean(
    window.Telegram?.WebApp?.initData,
  )

  // Защищённые проекты доступны только
  // подтверждённым пользователям Telegram.
  const canAccessProjects =
    isLocalDev || (isAuthenticated && Boolean(user))

  // Ожидаем проверку только тогда, когда
  // приложение действительно запущено через Telegram.
  if (hasTelegramSession && loading && !isLocalDev) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          justifyContent: 'center',
          alignItems: 'center',
          background: '#090a0b',
          color: '#ffffff',
          fontFamily: 'Arial, sans-serif',
        }}
      >
        Проверка авторизации...
      </div>
    )
  }

  // Если Telegram передал данные, но сервер
  // не подтвердил их, не допускаем такой вход.
  if (
    hasTelegramSession &&
    !canAccessProjects
  ) {
    return (
      <div
        style={{
          minHeight: '100vh',
          display: 'flex',
          flexDirection: 'column',
          justifyContent: 'center',
          alignItems: 'center',
          padding: 24,
          background: '#090a0b',
          color: '#ffffff',
          fontFamily: 'Arial, sans-serif',
          textAlign: 'center',
          boxSizing: 'border-box',
        }}
      >
        <h2>Ошибка авторизации</h2>

        <p
          style={{
            color: '#a5a5a5',
            maxWidth: 420,
            lineHeight: 1.7,
          }}
        >
          Telegram не смог подтвердить вход.
          Закрой приложение и открой его
          заново через бота.
        </p>
      </div>
    )
  }

  return (
    <BrowserRouter>
      <StudioShell>
          <Routes>
            <Route
              path="/"
              element={<Home />}
            />

            <Route
              path="/sounds"
              element={<Sounds />}
            />

            <Route
              path="/edits"
              element={<Edits />}
            />

            <Route
              path="/content"
              element={<Content />}
            />

            <Route
              path="/templates"
              element={<Templates />}
            />

            <Route
              path="/video"
              element={<Video />}
            />

            <Route
              path="/settings"
              element={<Settings />}
            />

            <Route
              path="/projects/:id"
              element={
                canAccessProjects ? (
                  <Project />
                ) : (
                  <div
                    style={{
                      minHeight: '70vh',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'center',
                      alignItems: 'center',
                      gap: 15,
                      padding: 24,
                      background: '#090a0b',
                      color: '#ffffff',
                      fontFamily:
                        'Arial, sans-serif',
                      textAlign: 'center',
                    }}
                  >
                    <h2>
                      Доступ к проекту
                    </h2>

                    <p
                      style={{
                        maxWidth: 420,
                        lineHeight: 1.7,
                        color: '#a5a5a5',
                      }}
                    >
                      Для открытия облачного
                      проекта необходимо войти
                      через Telegram.
                    </p>

                    <Link
                      to="/video"
                      style={{
                        display: 'inline-block',
                        padding: '13px 20px',
                        borderRadius: 12,
                        background: '#f3f3f2',
                        color: '#101010',
                        textDecoration: 'none',
                        fontWeight: 600,
                      }}
                    >
                      Открыть видеоредактор
                    </Link>
                  </div>
                )
              }
            />
          </Routes>
      </StudioShell>
    </BrowserRouter>
  )
}

function App() {
  return (
    <TelegramAuthProvider>
      <AppContent />
    </TelegramAuthProvider>
  )
}

export default App
