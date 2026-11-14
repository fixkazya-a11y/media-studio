import { useEffect, useState, type ReactNode } from 'react'
import { NavLink, useLocation } from 'react-router-dom'
import './StudioShell.css'

type IconName =
  | 'home' | 'audio' | 'layers' | 'image' | 'grid' | 'film' | 'settings'
  | 'menu' | 'close' | 'arrow' | 'spark' | 'folder'

type StudioShellProps = {
  children: ReactNode
}

/**
 * ЕДИНСТВО | MEDIA STUDIO — единый интерфейс.
 * Встроить внутрь существующего Router, не заменяя маршрутизацию.
 * Если у существующих разделов другие пути, измените только to у пунктов MENU.
 */
const MENU: { label: string; to: string; icon: IconName; end?: boolean }[] = [
  { label: 'Главная', to: '/', icon: 'home', end: true },
  { label: 'Мои звуки', to: '/sounds', icon: 'audio' },
  { label: 'Эдиты', to: '/edits', icon: 'layers' },
  { label: 'Контент', to: '/content', icon: 'image' },
  { label: 'Шаблоны', to: '/templates', icon: 'grid' },
  { label: 'Видеогенератор', to: '/video', icon: 'film' },
]

function Icon({ name, size = 19 }: { name: IconName; size?: number }) {
  const paths: Record<IconName, ReactNode> = {
    home: <><path d="m3 10 9-7 9 7" /><path d="M5 9.5V21h14V9.5" /><path d="M9 21v-7h6v7" /></>,
    audio: <><path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" /></>,
    layers: <><path d="m12 2 9 5-9 5-9-5 9-5Z" /><path d="m3 12 9 5 9-5M3 17l9 5 9-5" /></>,
    image: <><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="8.5" cy="8.5" r="1.5" /><path d="m21 15-5-5L5 21" /></>,
    grid: <><rect x="3" y="3" width="7" height="7" rx="1" /><rect x="14" y="3" width="7" height="7" rx="1" /><rect x="3" y="14" width="7" height="7" rx="1" /><rect x="14" y="14" width="7" height="7" rx="1" /></>,
    film: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M7 4v16M17 4v16M3 9h4m-4 6h4m10-6h4m-4 6h4" /><path d="m10 9 5 3-5 3Z" /></>,
    settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l-1.9 1.9a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21h-2.7v-.11a1.7 1.7 0 0 0-1.03-1.56 1.7 1.7 0 0 0-1.87.34l-1.9-1.9a1.7 1.7 0 0 0 .34-1.87 1.7 1.7 0 0 0-1.56-1.03H5v-2.7h.11a1.7 1.7 0 0 0 1.56-1.03 1.7 1.7 0 0 0-.34-1.87l1.9-1.9a1.7 1.7 0 0 0 1.87.34 1.7 1.7 0 0 0 1.03-1.56V5h2.7v.11a1.7 1.7 0 0 0 1.03 1.56 1.7 1.7 0 0 0 1.87-.34l1.9 1.9a1.7 1.7 0 0 0-.34 1.87 1.7 1.7 0 0 0 1.56 1.03H21v2.7h-.11a1.7 1.7 0 0 0-1.49 1.17Z"/></>,
    menu: <><path d="M4 7h16M4 12h16M4 17h16" /></>,
    close: <><path d="M5 5 19 19M19 5 5 19" /></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6" /></>,
    spark: <><path d="m12 2 1.9 7.1L21 11l-7.1 1.9L12 20l-1.9-7.1L3 11l7.1-1.9L12 2Z" /><path d="m19 19 1 2 2 1-2 1-1 2-1-2-2-1 2-1 1-2Z" /></>,
    folder: <><path d="M3 7a2 2 0 0 1 2-2h5l2 2h7a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z" /></>,
  }
  return (
    <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.55" strokeLinecap="round" strokeLinejoin="round">
      {paths[name]}
    </svg>
  )
}

export default function StudioShell({ children }: StudioShellProps) {
  const [menuOpen, setMenuOpen] = useState(false)
  const location = useLocation()
  const section = location.pathname === '/' ? 'ГЛАВНАЯ'
    : location.pathname.startsWith('/projects/') ? 'ПРОЕКТ'
    : location.pathname === '/sounds' ? 'МОИ ЗВУКИ'
    : location.pathname === '/edits' ? 'ЭДИТЫ'
    : location.pathname === '/content' ? 'КОНТЕНТ'
    : location.pathname === '/templates' ? 'ШАБЛОНЫ'
    : location.pathname === '/video' ? 'ВИДЕОГЕНЕРАТОР'
    : location.pathname === '/settings' ? 'НАСТРОЙКИ' : 'РАЗДЕЛ'

  useEffect(() => { setMenuOpen(false) }, [location.pathname])

  useEffect(() => {
    if (!menuOpen) return
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [menuOpen])

  return (
    <div className="edi-shell">
      <div className={`edi-scrim${menuOpen ? ' edi-scrim--show' : ''}`} onClick={() => setMenuOpen(false)} role="presentation" />
      <aside id="edi-sidebar" className={`edi-sidebar${menuOpen ? ' edi-sidebar--open' : ''}`} aria-label="Главная навигация">
        <div className="edi-sidebar__header">
          <NavLink className="edi-brand" to="/" aria-label="ЕДИНСТВО — на главную">
            <span className="edi-brand__symbol">Е</span>
            <span className="edi-brand__wordmark">
              <strong>ЕДИНСТВО</strong>
              <span>MEDIA STUDIO</span>
            </span>
          </NavLink>
          <button type="button" className="edi-sidebar__close" onClick={() => setMenuOpen(false)} aria-label="Закрыть меню"><Icon name="close" /></button>
        </div>

        <div className="edi-sidebar__body">
          <p className="edi-sidebar__group">РАБОЧЕЕ ПРОСТРАНСТВО</p>
          <nav className="edi-menu" aria-label="Разделы приложения">
            {MENU.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => `edi-menu__item${isActive ? ' edi-menu__item--active' : ''}`}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name={item.icon} />
                <span>{item.label}</span>
                <span className="edi-menu__chevron" aria-hidden="true">↗</span>
              </NavLink>
            ))}
          </nav>
        </div>

        <div className="edi-sidebar__footer">
          <NavLink to="/settings" className={({ isActive }) => `edi-menu__item${isActive ? ' edi-menu__item--active' : ''}`} onClick={() => setMenuOpen(false)}>
            <Icon name="settings" /><span>Настройки</span><span className="edi-menu__chevron" aria-hidden="true">↗</span>
          </NavLink>
          <div className="edi-sidebar__signature"><span className="edi-sidebar__signature-dot" /> MADE FOR CREATORS <span>© 2026</span></div>
        </div>
      </aside>

      <div className="edi-main">
        <header className="edi-topbar">
          <div className="edi-topbar__left">
            <button type="button" className="edi-topbar__menu" aria-label={menuOpen ? 'Закрыть меню' : 'Открыть меню'} aria-controls="edi-sidebar" aria-expanded={menuOpen} onClick={() => setMenuOpen((value) => !value)}>
              <Icon name={menuOpen ? 'close' : 'menu'} size={21} />
            </button>
            <span className="edi-topbar__breadcrumb">STUDIO <span>/</span> {section}</span>
          </div>
          <div className="edi-topbar__right">
            <span className="edi-topbar__edition">ЕДИНСТВО / MEDIA STUDIO</span>
          </div>
        </header>

        <div className="edi-content">{children}</div>
      </div>
    </div>
  )
}
