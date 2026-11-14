import { useEffect, useMemo, useRef, useState, type FormEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { getProjects, createProject, deleteProject, type Project } from '../services/projects'

const theme = `
  .edi-home, .edi-home * { box-sizing: border-box; }
  .edi-home {
    width: 100%; margin: 0 auto; max-width: 1380px;
    min-height: calc(100dvh - 70px); padding: 43px clamp(20px, 3.3vw, 54px) 80px;
    color: #f3f3f2; background: #090a0b;
    font-family: Inter, -apple-system, BlinkMacSystemFont, 'Segoe UI', Arial, sans-serif;
    color-scheme: dark;
  }
  .edi-home button, .edi-home input { font: inherit; }
  .edi-home button:focus-visible, .edi-home input:focus-visible { outline: 2px solid #fff; outline-offset: 3px; }
  .edi-home__eyebrow { color: #77797b; font-size: 10px; font-weight: 650; letter-spacing: .19em; }
  .edi-home__heading-row { display: flex; justify-content: space-between; gap: 20px; align-items: end; margin: 21px 0 38px; }
  .edi-home__title { margin: 0 0 10px; font-size: clamp(38px, 5vw, 70px); letter-spacing: -.065em; line-height: .99; font-weight: 780; }
  .edi-home__lead { margin: 0; color: #9fa1a3; font-size: 13px; line-height: 1.55; }
  .edi-home__edition { border: 1px solid #343536; border-radius: 24px; padding: 10px 15px; font-size: 10px; color: #aeb0b2; white-space: nowrap; letter-spacing: .07em; }
  .edi-home__workarea { display: grid; grid-template-columns: minmax(0, 1.25fr) minmax(260px, .75fr); gap: 13px; }
  .edi-home__create, .edi-home__continue, .edi-home__stats { border: 1px solid #27292b; border-radius: 17px; padding: 25px; min-width: 0; }
  .edi-home__create { background: #171819; display: flex; flex-direction: column; justify-content: space-between; min-height: 258px; }
  .edi-home__continue { background: #111213; display: flex; flex-direction: column; min-height: 258px; }
  .edi-home__kicker { font-size: 10px; letter-spacing: .15em; color: #858789; font-weight: 650; }
  .edi-home__block-title { font-size: clamp(22px, 2.4vw, 29px); margin: 13px 0 9px; font-weight: 720; letter-spacing: -.04em; }
  .edi-home__block-desc { font-size: 12px; line-height: 1.6; color: #959799; margin: 0; }
  .edi-home__form { display: flex; margin-top: 24px; gap: 9px; }
  .edi-home__input, .edi-home__search { background: #0a0b0c; border: 1px solid #393b3d; color: #fff; border-radius: 10px; outline: none; }
  .edi-home__input { flex: 1; width: 100px; min-width: 0; height: 48px; padding: 0 15px; font-size: 13px; }
  .edi-home__input::placeholder, .edi-home__search::placeholder { color: #707375; }
  .edi-home__input:focus, .edi-home__search:focus { border-color: #e4e4e4; }
  .edi-home__create-button { min-height: 48px; border: 0; background: #f3f3f2; color: #0a0b0c; border-radius: 10px; padding: 0 18px; font-weight: 750; font-size: 13px; cursor: pointer; white-space: nowrap; }
  .edi-home__create-button:hover:not(:disabled) { background: #d7d8d8; }
  .edi-home__create-button:disabled { opacity: .5; cursor: wait; }
  .edi-home__continue-icon { display: grid; place-items: center; border: 1px solid #454749; width: 37px; height: 37px; border-radius: 10px; font-size: 22px; }
  .edi-home__continue-inner { margin-top: auto; }
  .edi-home__continue-name { margin: 12px 0 10px; font-size: clamp(20px, 2vw, 25px); font-weight: 720; letter-spacing: -.035em; overflow-wrap: anywhere; }
  .edi-home__continue-bottom { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 20px; padding-top: 15px; border-top: 1px solid #313335; }
  .edi-home__text-button { background: transparent; border: 0; padding: 0; color: #fff; font-size: 12px; font-weight: 650; cursor: pointer; text-align: left; }
  .edi-home__text-button:hover { text-decoration: underline; }
  .edi-home__muted { color: #87898c; font-size: 11px; }
  .edi-home__section-top { display: flex; gap: 14px; justify-content: space-between; align-items: center; margin: 44px 0 18px; }
  .edi-home__section-title { margin: 0; font-size: 23px; font-weight: 730; letter-spacing: -.035em; }
  .edi-home__count { color: #85878a; font-weight: 450; font-size: 15px; margin-left: 9px; }
  .edi-home__search { width: 255px; max-width: 45%; height: 40px; padding: 0 13px; font-size: 12px; }
  .edi-home__projects { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 12px; }
  .edi-home__project { display: flex; flex-direction: column; min-width: 0; min-height: 168px; padding: 19px; text-align: left; border: 1px solid #292b2d; border-radius: 14px; background: #111213; color: #f3f3f2; cursor: pointer; transition: background .15s ease, border-color .15s ease, transform .15s ease; }
  .edi-home__project:hover { background: #191b1c; border-color: #5b5d5e; transform: translateY(-2px); }
  .edi-home__project { touch-action: pan-y; user-select: none; -webkit-user-select: none; -webkit-touch-callout: none; }
  .edi-home__project--selected, .edi-home__project--selected:hover { background: #ededeb; border-color: #ededeb; color: #101112; transform: none; }
  .edi-home__project--selected .edi-home__project-type { color: #37393b; border-color: #aaa; }
  .edi-home__project--selected .edi-home__project-foot { color: #595d5e; }
  .edi-home__select-circle { width: 24px; height: 24px; flex-shrink: 0; border-radius: 50%; display: grid; place-items: center; border: 1.5px solid #777a7d; font-size: 13px; font-weight: 800; }
  .edi-home__project--selected .edi-home__select-circle { background: #111213; border-color: #111213; color: #fff; }
  .edi-home__tools { display: flex; align-items: center; gap: 8px; margin-left: auto; }
  .edi-home__action { min-height: 40px; padding: 0 14px; border: 1px solid #414345; background: #171819; color: #f6f6f5; border-radius: 10px; font-size: 12px; font-weight: 650; cursor: pointer; white-space: nowrap; }
  .edi-home__action:hover:not(:disabled) { background: #282a2c; }
  .edi-home__action:disabled { opacity: .45; cursor: not-allowed; }
  .edi-home__action--danger { background: #f2f2f0; border-color: #f2f2f0; color: #101112; }
  .edi-home__action--danger:hover:not(:disabled) { background: #d4d4d2; }
  .edi-home__selection-bar { display: flex; flex-wrap: wrap; align-items: center; gap: 10px; padding: 12px 14px; border: 1px solid #393b3d; border-radius: 12px; background: #18191a; margin: 0 0 16px; }
  .edi-home__selection-copy { flex: 1; min-width: 130px; font-size: 12px; color: #d2d4d5; }
  .edi-home__selection-hint { margin: -9px 0 14px; color: #898b8d; font-size: 11px; line-height: 1.6; }
  .edi-home__notice { margin-top: 12px; color: #bebfbe; font-size: 12px; line-height: 1.6; }
  .edi-home__dialog-backdrop { position: fixed; inset: 0; z-index: 2500; background: rgba(0,0,0,.76); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; padding: 18px; }
  .edi-home__dialog { width: min(100%, 420px); border: 1px solid #3c3e40; border-radius: 20px; background: #191a1b; padding: 26px; box-shadow: 0 25px 85px rgba(0,0,0,.5); }
  .edi-home__dialog h3 { margin: 0 0 12px; color: #f6f6f5; font-size: 23px; letter-spacing: -.035em; }
  .edi-home__dialog p { margin: 0; color: #a9abad; font-size: 13px; line-height: 1.65; }
  .edi-home__dialog-actions { display: flex; justify-content: flex-end; flex-wrap: wrap; gap: 10px; margin-top: 25px; }
  .edi-home__project-head, .edi-home__project-foot { display: flex; justify-content: space-between; align-items: center; gap: 10px; }
  .edi-home__project-type { border: 1px solid #37393b; color: #a8aaac; border-radius: 6px; padding: 5px 8px; font-size: 10px; text-transform: uppercase; letter-spacing: .07em; white-space: nowrap; }
  .edi-home__project-arrow { color: #f3f3f2; font-size: 18px; }
  .edi-home__project-title { margin: 25px 0 16px; font-size: 17px; line-height: 1.3; font-weight: 700; letter-spacing: -.02em; overflow-wrap: anywhere; }
  .edi-home__project-foot { margin-top: auto; color: #898b8d; font-size: 10px; }
  .edi-home__placeholder { padding: 29px; text-align: center; border: 1px dashed #36383a; border-radius: 14px; color: #a6a8aa; font-size: 13px; line-height: 1.6; }
  .edi-home__message { margin-top: 18px; border: 1px solid #55585a; border-radius: 11px; padding: 14px; color: #ddd; font-size: 13px; background: #191a1c; display: flex; gap: 14px; align-items: center; justify-content: space-between; flex-wrap: wrap; }
  .edi-home__show-all { display: block; border: 1px solid #393b3d; color: #eee; background: #151617; border-radius: 10px; padding: 11px 18px; margin: 23px auto 0; font-size: 12px; cursor: pointer; }
  .edi-home__show-all:hover { background: #232526; }
  .edi-home__bottom { border-top: 1px solid #282a2c; margin-top: 56px; padding-top: 17px; display: flex; justify-content: space-between; gap: 14px; color: #7e8082; font-size: 9px; letter-spacing: .12em; }
  @media(max-width: 1020px) { .edi-home__projects { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
  @media(max-width: 740px) {
    .edi-home { min-height: calc(100dvh - 61px); padding: 32px 16px 65px; }
    .edi-home__heading-row { margin: 18px 0 27px; }
    .edi-home__title { font-size: clamp(37px, 11vw, 53px); }
    .edi-home__edition { display: none; }
    .edi-home__workarea { grid-template-columns: 1fr; }
    .edi-home__create, .edi-home__continue { padding: 21px; min-height: 0; }
    .edi-home__continue { min-height: 185px; }
    .edi-home__form { flex-direction: column; }
    .edi-home__input { width: 100%; flex: none; }
    .edi-home__create-button { width: 100%; }
    .edi-home__projects { grid-template-columns: 1fr; }
    .edi-home__section-top { align-items: stretch; flex-direction: column; margin-top: 34px; }
    .edi-home__tools { margin-left: 0; width: 100%; }
    .edi-home__tools .edi-home__search { flex: 1; min-width: 0; }
    .edi-home__selection-bar .edi-home__action { flex: 1; }
    .edi-home__search { width: 100%; max-width: none; }
    .edi-home__project { min-height: 143px; }
  }
  @media(prefers-reduced-motion: reduce) { .edi-home *, .edi-home *::before, .edi-home *::after { transition: none !important; } }
`

const TYPE_LABELS: Record<string, string> = {
  karaoke: 'Караоке', video: 'Видео', design: 'Дизайн', music: 'Музыка', audio: 'Аудио',
}

function typeName(type: string): string {
  return TYPE_LABELS[type.toLowerCase()] || type
}

function dateLabel(value: string): string {
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? 'Без даты' : parsed.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' })
}

export default function Home() {
  const navigate = useNavigate()
  const [projects, setProjects] = useState<Project[]>([])
  const [projectName, setProjectName] = useState('')
  const [search, setSearch] = useState('')
  const [showAll, setShowAll] = useState(false)
  const [loading, setLoading] = useState(true)
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [selecting, setSelecting] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set())
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const pressTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pressStart = useRef<{ x: number; y: number } | null>(null)
  const suppressClick = useRef<{ id: string; until: number } | null>(null)

  async function loadProjects() {
    try {
      setLoading(true)
      setError('')
      setProjects(await getProjects())
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось загрузить проекты')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void loadProjects() }, [])
  useEffect(() => () => {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current)
  }, [])

  function stopLongPress() {
    if (pressTimer.current !== null) clearTimeout(pressTimer.current)
    pressTimer.current = null
    pressStart.current = null
  }

  function beginSelection(id: string) {
    if (deleting) return
    setSelecting(true)
    setShowAll(true)
    setSelectedIds((current) => {
      const next = new Set(current)
      next.add(id)
      return next
    })
  }

  function toggleSelected(id: string) {
    if (deleting) return
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  function handlePointerDown(event: ReactPointerEvent<HTMLButtonElement>, id: string) {
    stopLongPress()
    if (selecting || deleting || event.button !== 0) return
    pressStart.current = { x: event.clientX, y: event.clientY }
    pressTimer.current = setTimeout(() => {
      pressTimer.current = null
      pressStart.current = null
      suppressClick.current = { id, until: Date.now() + 900 }
      beginSelection(id)
      try { window.navigator.vibrate?.(25) } catch { /* vibration is optional */ }
    }, 550)
  }

  function handlePointerMove(event: ReactPointerEvent<HTMLButtonElement>) {
    if (!pressStart.current) return
    if (Math.abs(event.clientX - pressStart.current.x) > 12 ||
        Math.abs(event.clientY - pressStart.current.y) > 12) {
      stopLongPress()
    }
  }

  function handleProjectClick(id: string) {
    if (deleting) return
    if (suppressClick.current?.id === id && Date.now() < suppressClick.current.until) {
      suppressClick.current = null
      return
    }
    suppressClick.current = null
    if (selecting) toggleSelected(id)
    else navigate(`/projects/${id}`)
  }

  function cancelSelection() {
    stopLongPress()
    setSelecting(false)
    setSelectedIds(new Set())
    setConfirmDelete(false)
  }

  async function handleDeleteSelected() {
    if (deleting || selectedIds.size === 0) return
    const targets = projects.filter((project) => selectedIds.has(String(project.id)))
    if (!targets.length) return
    setDeleting(true)
    setError('')
    setNotice('')

    const successful = new Set<string>()
    const failed: string[] = []
    const failedNames: string[] = []

    for (const project of targets) {
      try {
        await deleteProject(project.id)
        successful.add(String(project.id))
      } catch (err) {
        failed.push(String(project.id))
        failedNames.push(`${project.name}: ${err instanceof Error ? err.message : 'ошибка удаления'}`)
      }
    }

    setProjects((current) => current.filter((project) => !successful.has(String(project.id))))
    setSelectedIds(new Set(failed))
    setConfirmDelete(false)
    setDeleting(false)

    if (failed.length > 0) {
      setSelecting(true)
      setError(`Не удалось удалить ${failed.length} из ${targets.length}: ${failedNames.join('; ')}`)
    } else {
      setSelecting(false)
      setNotice(`Удалено проектов: ${successful.size}`)
    }
  }

  async function handleCreateProject(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (creating) return
    try {
      setCreating(true)
      setError('')
      const created = await createProject(projectName.trim() || 'Новый проект')
      setProjects((current) => [created, ...current])
      setProjectName('')
      setSearch('')
      setShowAll(false)
      setNotice('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось создать проект')
    } finally {
      setCreating(false)
    }
  }

  const ordered = useMemo(() => [...projects].sort((a, b) => (new Date(b.created_at).getTime() || 0) - (new Date(a.created_at).getTime() || 0)), [projects])
  const newest = ordered[0]
  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase()
    return text ? ordered.filter((project) => `${project.name} ${project.project_type} ${typeName(project.project_type)}`.toLowerCase().includes(text)) : ordered
  }, [ordered, search])
  const visible = search.trim() || showAll || selecting ? filtered : filtered.slice(0, 6)

  return (
    <main className="edi-home">
      <style>{theme}</style>
      <div className="edi-home__eyebrow">ЕДИНСТВО / ЦИФРОВАЯ СТУДИЯ / 2026</div>
      <header className="edi-home__heading-row">
        <div>
          <h1 className="edi-home__title">Твоя студия.</h1>
          <p className="edi-home__lead">От первой идеи до готового релиза — всё в одном месте.</p>
        </div>
        <div className="edi-home__edition">CREATIVE WORKSPACE / 01</div>
      </header>

      <section className="edi-home__workarea" aria-label="Быстрый доступ">
        <div className="edi-home__create">
          <div>
            <div className="edi-home__kicker">01 / НОВАЯ РАБОТА</div>
            <h2 className="edi-home__block-title">Создать проект</h2>
            <p className="edi-home__block-desc">Начни с названия. Остальное добавишь в редакторе.</p>
          </div>
          <form className="edi-home__form" onSubmit={handleCreateProject}>
            <input className="edi-home__input" aria-label="Название нового проекта" type="text" maxLength={100} value={projectName} onChange={(e) => setProjectName(e.target.value)} placeholder="Название проекта" disabled={creating} />
            <button type="submit" className="edi-home__create-button" disabled={creating}>{creating ? 'Создаём…' : 'Создать  ↗'}</button>
          </form>
        </div>
        <div className="edi-home__continue">
          <div className="edi-home__continue-icon" aria-hidden="true">↗</div>
          <div className="edi-home__continue-inner">
            <div className="edi-home__kicker">02 / ПРОДОЛЖИТЬ</div>
            <div className="edi-home__continue-name">{loading ? 'Загрузка…' : newest ? newest.name : 'Твой первый проект'}</div>
            <p className="edi-home__block-desc">{newest ? `${typeName(newest.project_type)} · ${dateLabel(newest.created_at)}` : 'Создай проект, чтобы продолжить работу позже.'}</p>
            {newest && (
              <div className="edi-home__continue-bottom">
                <button type="button" className="edi-home__text-button" onClick={() => navigate(`/projects/${newest.id}`)}>Открыть проект</button>
                <span aria-hidden="true">→</span>
              </div>
            )}
          </div>
        </div>
      </section>

      {error && <div className="edi-home__message" role="alert"><span>{error}</span><button type="button" className="edi-home__text-button" onClick={() => void loadProjects()}>Повторить</button></div>}
      {notice && <div className="edi-home__notice" role="status">{notice}</div>}

      <section aria-label="Мои проекты">
        <div className="edi-home__section-top">
          <h2 className="edi-home__section-title">Мои проекты <span className="edi-home__count">{loading ? '—' : projects.length}</span></h2>
          <div className="edi-home__tools">
            <input type="search" className="edi-home__search" aria-label="Поиск проектов" placeholder="Поиск по проектам..." value={search} onChange={(e) => { setSearch(e.target.value); if (!selecting) setShowAll(false) }} />
            {!selecting && projects.length > 0 && (
              <button type="button" className="edi-home__action" onClick={() => { setSelecting(true); setShowAll(true); setNotice('') }}>
                Выбрать
              </button>
            )}
          </div>
        </div>
        {selecting && (
          <div className="edi-home__selection-bar">
            <span className="edi-home__selection-copy">Выбрано проектов: <strong>{selectedIds.size}</strong></span>
            <button type="button" className="edi-home__action" onClick={cancelSelection} disabled={deleting}>Отмена</button>
            <button type="button" className="edi-home__action edi-home__action--danger" onClick={() => setConfirmDelete(true)} disabled={deleting || selectedIds.size === 0}>Удалить ({selectedIds.size})</button>
          </div>
        )}
        {!selecting && !loading && projects.length > 0 && <div className="edi-home__selection-hint">Удерживай карточку проекта, чтобы выделить несколько и удалить.</div>}
        {loading ? (
          <div className="edi-home__placeholder">Загружаем проекты…</div>
        ) : filtered.length === 0 ? (
          <div className="edi-home__placeholder">{search ? 'Проекты по такому запросу не найдены.' : 'Здесь появятся твои проекты. Создай первый выше.'}</div>
        ) : (
          <div className="edi-home__projects">
            {visible.map((project) => {
              const id = String(project.id)
              const checked = selectedIds.has(id)
              return (
                <button
                  key={id}
                  type="button"
                  className={`edi-home__project${checked ? ' edi-home__project--selected' : ''}`}
                  onPointerDown={(event) => handlePointerDown(event, id)}
                  onPointerMove={handlePointerMove}
                  onPointerUp={stopLongPress}
                  onPointerCancel={stopLongPress}
                  onPointerLeave={stopLongPress}
                  onContextMenu={(event) => { event.preventDefault(); stopLongPress(); suppressClick.current = { id, until: Date.now() + 900 }; beginSelection(id) }}
                  onClick={() => handleProjectClick(id)}
                  disabled={deleting}
                  aria-pressed={selecting ? checked : undefined}
                  aria-label={selecting ? `${checked ? 'Снять выделение' : 'Выделить'}: ${project.name}` : `Открыть проект ${project.name}`}
                >
                  <span className="edi-home__project-head">
                    <span className="edi-home__project-type">{typeName(project.project_type)}</span>
                    {selecting ? (
                      <span className="edi-home__select-circle" aria-hidden="true">{checked ? '✓' : ''}</span>
                    ) : (
                      <span className="edi-home__project-arrow" aria-hidden="true">↗</span>
                    )}
                  </span>
                  <span className="edi-home__project-title">{project.name}</span>
                  <span className="edi-home__project-foot"><span>{dateLabel(project.created_at)}</span><span>{selecting ? (checked ? 'ВЫБРАН' : 'ВЫБРАТЬ') : 'ОТКРЫТЬ →'}</span></span>
                </button>
              )
            })}
          </div>
        )}
        {!loading && !selecting && !search.trim() && ordered.length > 6 && (
          <button className="edi-home__show-all" type="button" onClick={() => setShowAll((current) => !current)}>{showAll ? 'Показать меньше' : `Все проекты (${ordered.length})`}</button>
        )}
      </section>

      <footer className="edi-home__bottom"><span>ЕДИНСТВО © 2026</span><span>MADE FOR CREATORS</span></footer>
      {confirmDelete && (
        <div className="edi-home__dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !deleting) setConfirmDelete(false) }}>
          <div className="edi-home__dialog" role="alertdialog" aria-modal="true" aria-labelledby="edi-delete-title" aria-describedby="edi-delete-desc">
            <h3 id="edi-delete-title">Удалить проекты?</h3>
            <p id="edi-delete-desc">Выбрано: {selectedIds.size}. Проекты будут удалены из твоего аккаунта. Это действие может быть необратимым.</p>
            <div className="edi-home__dialog-actions">
              <button type="button" className="edi-home__action" onClick={() => setConfirmDelete(false)} disabled={deleting}>Отмена</button>
              <button type="button" className="edi-home__action edi-home__action--danger" onClick={() => void handleDeleteSelected()} disabled={deleting} autoFocus>{deleting ? 'Удаляем…' : `Удалить (${selectedIds.size})`}</button>
            </div>
          </div>
        </div>
      )}
    </main>
  )
}
