
import { useTelegramAuth } from '../telegram/TelegramAuthContext'

export default function Settings() {
  const { user, loading, isAuthenticated } = useTelegramAuth()

  if (loading) {
    return <h1>Загрузка профиля...</h1>
  }

  if (!isAuthenticated || !user) {
    return <h1>Профиль недоступен</h1>
  }

  const fullName = [user.first_name, user.last_name]
    .filter(Boolean)
    .join(' ')

  return (
    <section>
      <h1>Настройки</h1>

      <div>
        <h2>Мой аккаунт</h2>

        <p>Имя: {fullName}</p>

        <p>
          Username: {user.username ? `@${user.username}` : 'Не указан'}
        </p>

        <p>
          Статус: Подключён через Telegram
        </p>
      </div>
    </section>
  )
}
