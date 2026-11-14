
import { NavLink } from 'react-router-dom'

const navigation = [
  { name: 'Главная', path: '/' },
  { name: 'Мои звуки', path: '/sounds' },
  { name: 'Эдиты', path: '/edits' },
  { name: 'Контент', path: '/content' },
  { name: 'Шаблоны', path: '/templates' },
  { name: 'Видеогенератор', path: '/video' },
  { name: 'Настройки', path: '/settings' },
]

export default function Sidebar() {
  return (
    <nav>
      {navigation.map((item) => (
        <NavLink
          key={item.path}
          to={item.path}
          end={item.path === '/'}
          style={({ isActive }) => ({
            display: 'block',
            padding: '12px',
            color: isActive ? 'blue' : 'black',
            textDecoration: 'none',
          })}
        >
          {item.name}
        </NavLink>
      ))}
    </nav>
  )
}
