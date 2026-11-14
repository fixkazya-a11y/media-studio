
import { useEffect, useState, useRef, type ChangeEvent } from 'react'
import { useParams, useNavigate } from 'react-router-dom'

import { telegram } from '../telegram/telegram'
import KaraokePlayer from '../components/KaraokePlayer'

import {
  getProject,
  updateProject,
  updateProjectData,
  deleteProject,
  type Project as ProjectType,
} from '../services/projects'

import {
  saveProjectAudio,
  getProjectAudio,
  deleteProjectAudio,
  type StoredProjectAudio,
} from '../services/audioStorage'

import {
  createAudioUpload,
  uploadAudioFile,
  getAudioDownloadUrl,
  deleteCloudAudio,
} from '../services/cloudAudio'

type SyncedLine = {
  id: number
  text: string
  time: number | null
}

type CloudAudio = {
  path: string
  name: string
  size: string
  type: string
}

type TimingUndo = {
  lineId: number
  previousTime: number | null
  lineIndex: number
}

function isCloudAudio(value: unknown): value is CloudAudio {
  if (!value || typeof value !== 'object') return false

  const audio = value as Record<string, unknown>

  return (
    typeof audio.path === 'string' &&
    typeof audio.name === 'string' &&
    typeof audio.size === 'string' &&
    typeof audio.type === 'string'
  )
}

function createLines(text: string): SyncedLine[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim())
    .map((line, index) => ({
      id: index + 1,
      text: line,
      time: null,
    }))
}

export default function Project() {
  const { id } = useParams()
  const navigate = useNavigate()
  const audioRef = useRef<HTMLAudioElement | null>(null)

  const isLocalMode = import.meta.env.DEV && !telegram?.initData

  const loadedRef = useRef(false)
  const lyricsDirtyRef = useRef(false)
  const linesDirtyRef = useRef(false)
  const lyricsSavingRef = useRef(false)
  const linesSavingRef = useRef(false)

  const latestLyricsRef = useRef('')
  const latestLinesRef = useRef<SyncedLine[]>([])
  const lastUpdatedAtRef = useRef('')
  const timingUndoRef = useRef<TimingUndo | null>(null)

  const [project, setProject] = useState<ProjectType | null>(null)
  const [projectName, setProjectName] = useState('')
  const [audio, setAudio] = useState<StoredProjectAudio | null>(null)
  const [cloudAudio, setCloudAudio] = useState<CloudAudio | null>(null)
  const [audioUrl, setAudioUrl] = useState('')
  const [lyrics, setLyrics] = useState('')
  const [lines, setLines] = useState<SyncedLine[]>([])

  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [savingLyrics, setSavingLyrics] = useState(false)
  const [savingSync, setSavingSync] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [playing, setPlaying] = useState(false)

  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)

  const [showKaraoke, setShowKaraoke] = useState(false)
  const [selectedLineIndex, setSelectedLineIndex] = useState(0)
  const [canUndoTiming, setCanUndoTiming] = useState(false)

  const [confirmDelete, setConfirmDelete] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')

  const hasAudio = Boolean(cloudAudio || audio)

  useEffect(() => {
    let cancelled = false

    async function loadProject() {
      loadedRef.current = false

      if (!id) {
        setError('Не указан ID проекта')
        setLoading(false)
        return
      }

      try {
        setError('')

        const [result, savedAudio] = await Promise.all([
          getProject(id),
          getProjectAudio(id),
        ])

        if (cancelled) return

        const savedLyrics = result.data?.lyrics
        const savedSync = result.data?.syncedLines

        const text =
          typeof savedLyrics === 'string' ? savedLyrics : ''

        const initialLines = Array.isArray(savedSync)
          ? (savedSync as SyncedLine[])
          : createLines(text)

        setProject(result)
        setProjectName(result.name)
        setAudio(savedAudio ?? null)

        setCloudAudio(
          isCloudAudio(result.data?.audio)
            ? result.data.audio
            : null,
        )

        latestLyricsRef.current = text
        latestLinesRef.current = initialLines

        lyricsDirtyRef.current = false
        linesDirtyRef.current = false
        timingUndoRef.current = null

        setLyrics(text)
        setLines(initialLines)
        setSelectedLineIndex(0)
        setCanUndoTiming(false)

        lastUpdatedAtRef.current = result.updated_at

        loadedRef.current = true
      } catch (err) {
        if (!cancelled) {
          setError(
            err instanceof Error
              ? err.message
              : 'Не удалось загрузить проект',
          )
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    void loadProject()

    return () => {
      cancelled = true
      loadedRef.current = false
    }
  }, [id])

  useEffect(() => {
    let cancelled = false
    let localUrl = ''

    async function loadAudioUrl() {
      if (cloudAudio && id && !isLocalMode) {
        setAudioUrl('')

        try {
          const url = await getAudioDownloadUrl(id, cloudAudio.path)

          if (!cancelled) setAudioUrl(url)
        } catch (err) {
          if (!cancelled) {
            if (audio) {
              localUrl = URL.createObjectURL(audio.file)
              setAudioUrl(localUrl)

              setError(
                'Не удалось получить аудио из облака. Используется локальная копия.',
              )
            } else {
              setError(
                err instanceof Error
                  ? err.message
                  : 'Не удалось загрузить аудио из облака',
              )
            }
          }
        }

        return
      }

      if (audio) {
        localUrl = URL.createObjectURL(audio.file)
        setAudioUrl(localUrl)
      } else {
        setAudioUrl('')
      }
    }

    void loadAudioUrl()

    return () => {
      cancelled = true

      if (localUrl) URL.revokeObjectURL(localUrl)
    }
  }, [audio, cloudAudio, id, isLocalMode])

  useEffect(() => {
    if (!audioUrl || !audioRef.current) return

    audioRef.current.pause()
    audioRef.current.currentTime = 0

    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)
  }, [audioUrl])

  useEffect(() => {
    if (!playing) return

    let animationFrame = 0

    function updateTime() {
      const player = audioRef.current

      if (!player || player.paused || player.ended) return

      setCurrentTime(player.currentTime)

      animationFrame = requestAnimationFrame(updateTime)
    }

    animationFrame = requestAnimationFrame(updateTime)

    return () => {
      cancelAnimationFrame(animationFrame)
    }
  }, [playing])

  async function flushLyrics() {
    if (!id || !loadedRef.current || lyricsSavingRef.current) return

    lyricsSavingRef.current = true
    setSavingLyrics(true)

    try {
      while (lyricsDirtyRef.current && loadedRef.current) {
        const textToSave = latestLyricsRef.current

        const updated = await updateProjectData(id, {
          lyrics: textToSave,
        })

        setProject(updated)
        lastUpdatedAtRef.current = updated.updated_at

        if (latestLyricsRef.current === textToSave) {
          lyricsDirtyRef.current = false
        }
      }

      setMessage('Текст автоматически сохранён')
      setError('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось автоматически сохранить текст',
      )
    } finally {
      lyricsSavingRef.current = false
      setSavingLyrics(false)
    }
  }

  async function flushLines() {
    if (!id || !loadedRef.current || linesSavingRef.current) return

    linesSavingRef.current = true
    setSavingSync(true)

    try {
      while (linesDirtyRef.current && loadedRef.current) {
        const linesToSave = latestLinesRef.current

        const updated = await updateProjectData(id, {
          syncedLines: linesToSave,
        })

        setProject(updated)
        lastUpdatedAtRef.current = updated.updated_at

        if (
          JSON.stringify(latestLinesRef.current) ===
          JSON.stringify(linesToSave)
        ) {
          linesDirtyRef.current = false
        }
      }

      setMessage('Тайминги автоматически сохранены')
      setError('')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Не удалось автоматически сохранить тайминги',
      )
    } finally {
      linesSavingRef.current = false
      setSavingSync(false)
    }
  }

  useEffect(() => {
    latestLyricsRef.current = lyrics

    if (!loadedRef.current || !lyricsDirtyRef.current) return

    const timer = window.setTimeout(() => {
      void flushLyrics()
    }, 800)

    return () => window.clearTimeout(timer)
  }, [lyrics, id])

  useEffect(() => {
    latestLinesRef.current = lines

    if (!loadedRef.current || !linesDirtyRef.current) return

    const timer = window.setTimeout(() => {
      void flushLines()
    }, 800)

    return () => window.clearTimeout(timer)
  }, [lines, id])

  useEffect(() => {
    if (!id || isLocalMode) return

    const timer = window.setInterval(async () => {
      if (
        !loadedRef.current ||
        lyricsDirtyRef.current ||
        linesDirtyRef.current ||
        lyricsSavingRef.current ||
        linesSavingRef.current
      ) {
        return
      }

      try {
        const remote = await getProject(id)

        if (!loadedRef.current) return
        if (remote.updated_at === lastUpdatedAtRef.current) return

        const remoteLyrics =
          typeof remote.data?.lyrics === 'string'
            ? remote.data.lyrics
            : ''

        const remoteLines = Array.isArray(remote.data?.syncedLines)
          ? (remote.data.syncedLines as SyncedLine[])
          : createLines(remoteLyrics)

        setProject(remote)
        setProjectName(remote.name)

        if (remoteLyrics !== latestLyricsRef.current) {
          latestLyricsRef.current = remoteLyrics
          setLyrics(remoteLyrics)
        }

        if (
          JSON.stringify(remoteLines) !==
          JSON.stringify(latestLinesRef.current)
        ) {
          latestLinesRef.current = remoteLines
          setLines(remoteLines)
          timingUndoRef.current = null
          setCanUndoTiming(false)
          setSelectedLineIndex((current) =>
            Math.min(current, Math.max(0, remoteLines.length - 1)),
          )
        }

        const remoteAudio = remote.data?.audio

        setCloudAudio(
          isCloudAudio(remoteAudio) ? remoteAudio : null,
        )

        lastUpdatedAtRef.current = remote.updated_at

        setMessage('Получены обновления проекта')
        setError('')
      } catch {
        // Повторная проверка через 3 секунды
      }
    }, 3000)

    return () => window.clearInterval(timer)
  }, [id, isLocalMode])

  function formatTime(time: number | null) {
    if (time === null) return '--:--.---'

    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)
    const milliseconds = Math.floor((time % 1) * 1000)

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}.${String(milliseconds).padStart(3, '0')}`
  }

  function formatPlayerTime(time: number) {
    if (!Number.isFinite(time)) return '00:00'

    const minutes = Math.floor(time / 60)
    const seconds = Math.floor(time % 60)

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  const activeLineId = lines
    .filter(
      (line) => line.time !== null && line.time <= currentTime,
    )
    .sort((a, b) => (a.time ?? 0) - (b.time ?? 0))
    .pop()?.id ?? null

  const selectedLine = lines[selectedLineIndex] ?? null

  async function handleSave() {
    if (!id || !projectName.trim()) {
      setError('Название проекта не может быть пустым')
      return
    }

    try {
      setSaving(true)
      setError('')
      setMessage('')

      const updated = await updateProject(id, {
        name: projectName.trim(),
      })

      setProject(updated)
      lastUpdatedAtRef.current = updated.updated_at
      setProjectName(updated.name)

      setMessage('Название проекта сохранено!')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Ошибка сохранения')
    } finally {
      setSaving(false)
    }
  }

  function handleLyricsChange(value: string) {
    latestLyricsRef.current = value
    lyricsDirtyRef.current = true
    setLyrics(value)
  }

  async function handleSaveLyrics() {
    if (!id || !loadedRef.current) return

    latestLyricsRef.current = lyrics
    lyricsDirtyRef.current = true

    await flushLyrics()
  }

  async function handleSaveSync(updatedLines = lines) {
    if (!id || !loadedRef.current) return

    latestLinesRef.current = updatedLines
    linesDirtyRef.current = true
    setLines(updatedLines)

    await flushLines()
  }

  function handleGenerateLines() {
    const newLines = createLines(lyrics)

    latestLinesRef.current = newLines
    linesDirtyRef.current = true
    timingUndoRef.current = null

    setLines(newLines)
    setSelectedLineIndex(0)
    setCanUndoTiming(false)
    setMessage('Строки подготовлены. Сохраняем...')
  }

  function handleResetAllTimes() {
    const synchronizedLines = latestLinesRef.current.filter(
      (line) => line.time !== null,
    ).length

    if (synchronizedLines === 0) {
      setMessage('Нет таймингов для сброса.')
      return
    }

    const updatedLines = latestLinesRef.current.map((line) => ({
      ...line,
      time: null,
    }))

    latestLinesRef.current = updatedLines
    linesDirtyRef.current = true
    timingUndoRef.current = null

    setLines(updatedLines)
    setSelectedLineIndex(0)
    setCanUndoTiming(false)
    setMessage('Все тайминги сброшены. Сохраняем...')
  }

  async function handlePlay() {
    if (!audioRef.current) {
      setError('Сначала загрузи песню')
      return
    }

    try {
      if (audioRef.current.paused) {
        await audioRef.current.play()
        setPlaying(true)
      } else {
        audioRef.current.pause()
        setPlaying(false)
      }
    } catch {
      setError('Не удалось воспроизвести аудио')
    }
  }

  function handleSeek(value: string) {
    const audioElement = audioRef.current
    const time = Number(value)

    if (!audioElement || !Number.isFinite(time)) return

    audioElement.currentTime = time
    setCurrentTime(time)
  }

  function handleSelectLine(index: number) {
    if (index < 0 || index >= lines.length) return

    setSelectedLineIndex(index)
  }

  function handlePreviousLine() {
    setSelectedLineIndex((current) => Math.max(0, current - 1))
  }

  function handleNextLine() {
    setSelectedLineIndex((current) =>
      Math.min(lines.length - 1, current + 1),
    )
  }

  function handleCaptureLine() {
    const player = audioRef.current

    if (!player || !selectedLine) {
      setError('Сначала подготовь строки и загрузи песню')
      return
    }

    const currentAudioTime = player.currentTime
    const currentLine = lines[selectedLineIndex]

    if (!currentLine) return

    timingUndoRef.current = {
      lineId: currentLine.id,
      previousTime: currentLine.time,
      lineIndex: selectedLineIndex,
    }

    setCanUndoTiming(true)

    const updatedLines = latestLinesRef.current.map((line) =>
      line.id === currentLine.id
        ? { ...line, time: currentAudioTime }
        : line,
    )

    latestLinesRef.current = updatedLines
    linesDirtyRef.current = true

    setLines(updatedLines)
    setCurrentTime(currentAudioTime)

    if (selectedLineIndex < updatedLines.length - 1) {
      setSelectedLineIndex(selectedLineIndex + 1)
      setMessage(`Тайминг установлен: ${currentLine.text}`)
    } else {
      setMessage('Последняя строка синхронизирована!')
    }
  }

  function handleUndoTiming() {
    const lastAction = timingUndoRef.current

    if (!lastAction) return

    const updatedLines = latestLinesRef.current.map((line) =>
      line.id === lastAction.lineId
        ? { ...line, time: lastAction.previousTime }
        : line,
    )

    latestLinesRef.current = updatedLines
    linesDirtyRef.current = true

    setLines(updatedLines)
    setSelectedLineIndex(lastAction.lineIndex)

    timingUndoRef.current = null
    setCanUndoTiming(false)

    setMessage('Последний тайминг отменён')
  }

  function handleEditTime(index: number, value: string) {
    const seconds = Number(value)

    if (
      value.trim() === '' ||
      !Number.isFinite(seconds) ||
      seconds < 0
    ) {
      return
    }

    const updatedLines = latestLinesRef.current.map((line, i) =>
      i === index ? { ...line, time: seconds } : line,
    )

    latestLinesRef.current = updatedLines
    linesDirtyRef.current = true
    timingUndoRef.current = null

    setLines(updatedLines)
    setCanUndoTiming(false)
  }

  function handleDeleteTime(index: number) {
    const updatedLines = latestLinesRef.current.map((line, i) =>
      i === index ? { ...line, time: null } : line,
    )

    latestLinesRef.current = updatedLines
    linesDirtyRef.current = true
    timingUndoRef.current = null

    setLines(updatedLines)
    setCanUndoTiming(false)
  }

  async function handleUploadAudio(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]

    if (!file || !id) return

    if (!/\.(mp3|wav)$/i.test(file.name)) {
      setError('Поддерживаются только MP3 и WAV')
      event.target.value = ''
      return
    }

    try {
      setUploading(true)
      setError('')
      setMessage('Сохраняем аудио...')

      const savedAudio: StoredProjectAudio = {
        projectId: id,
        name: file.name,
        size: `${(file.size / 1024 / 1024).toFixed(2)} MB`,
        type: file.type || 'audio/mpeg',
        file,
      }

      if (isLocalMode) {
        await saveProjectAudio(savedAudio)

        setCloudAudio(null)
        setAudio(savedAudio)

        setMessage('Аудио сохранено локально!')
        return
      }

      setMessage('Создаём ссылку для загрузки...')

      const uploadData = await createAudioUpload(id, file.name)

      await uploadAudioFile(
        uploadData.signedUrl,
        file,
        uploadData.contentType,
      )

      const newCloudAudio: CloudAudio = {
        path: uploadData.path,
        name: file.name,
        size: savedAudio.size,
        type: savedAudio.type,
      }

      const updated = await updateProjectData(id, {
        audio: newCloudAudio,
      })

      await saveProjectAudio(savedAudio).catch(() => undefined)

      setProject(updated)
      lastUpdatedAtRef.current = updated.updated_at

      setCloudAudio(newCloudAudio)
      setAudio(savedAudio)

      setMessage('Аудио успешно загружено в облако!')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Ошибка загрузки аудио',
      )

      setMessage('')
    } finally {
      setUploading(false)
      event.target.value = ''
    }
  }

  async function handleRemoveAudio() {
    if (!id) return

    try {
      setUploading(true)
      setError('')
      setMessage('Удаляем аудио...')

      if (cloudAudio && !isLocalMode) {
        await deleteCloudAudio(id, cloudAudio.path)

        const updated = await updateProjectData(id, {
          audio: null,
        })

        setProject(updated)
        lastUpdatedAtRef.current = updated.updated_at
      }

      await deleteProjectAudio(id)

      if (audioRef.current) {
        audioRef.current.pause()
        audioRef.current.removeAttribute('src')
        audioRef.current.load()
      }

      setCloudAudio(null)
      setAudio(null)
      setAudioUrl('')
      setPlaying(false)
      setCurrentTime(0)
      setDuration(0)

      setMessage('Аудиофайл удалён')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Ошибка удаления аудио',
      )

      setMessage('')
    } finally {
      setUploading(false)
    }
  }

  async function handleDelete() {
    if (!id) return

    try {
      setDeleting(true)
      setError('')

      if (cloudAudio && !isLocalMode) {
        await deleteCloudAudio(id, cloudAudio.path)
      }

      await deleteProject(id)
      await deleteProjectAudio(id)

      navigate('/')
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : 'Ошибка удаления аудио',
      )

      setDeleting(false)
      setConfirmDelete(false)
    }
  }

  if (loading) return <div>Загрузка проекта...</div>

  if (error && !project) {
    return (
      <div>
        <h1>Ошибка</h1>
        <p>{error}</p>

        <button onClick={() => navigate('/')}>
          Вернуться к проектам
        </button>
      </div>
    )
  }

  if (!project) return <div>Проект не найден</div>

  const synchronizedCount = lines.filter(
    (line) => line.time !== null,
  ).length

  const seekProgress =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0

  return (
    <div className="ms-project">
      <style>{`
        .ms-project {
          color: inherit;
        }

        .ms-project button {
          transition:
            transform 150ms ease,
            background 150ms ease,
            border-color 150ms ease,
            box-shadow 150ms ease,
            opacity 150ms ease;
          -webkit-tap-highlight-color: transparent;
        }

        .ms-project button:active:not(:disabled) {
          transform: scale(0.97);
          filter: brightness(0.85);
        }

        .ms-project button:disabled {
          cursor: not-allowed;
        }

        .ms-project button:focus-visible,
        .ms-project textarea:focus-visible,
        .ms-project input:focus-visible {
          outline: 2px solid rgba(160, 175, 210, 0.7);
          outline-offset: 2px;
        }

        .ms-lyrics-editor {
          display: block;
          width: 100%;
          max-width: 620px;
          min-height: 125px;
          padding: 15px 16px;
          box-sizing: border-box;
          resize: vertical;
          border: 1px solid #303440;
          border-radius: 13px;
          background: #151821;
          color: #ffffff;
          font: inherit;
          font-size: 14px;
          line-height: 1.65;
          outline: none;
          transition:
            border-color 180ms ease,
            background 180ms ease,
            box-shadow 180ms ease;
        }

        .ms-lyrics-editor::placeholder {
          color: #737b8b;
        }

        .ms-lyrics-editor:focus {
          border-color: #626d82;
          background: #191d27;
          box-shadow: 0 0 0 3px rgba(120, 135, 165, 0.08);
        }

        .ms-player {
          width: 100%;
          max-width: 650px;
          margin: 18px 0;
          padding: 22px;
          box-sizing: border-box;
          border: 1px solid #303440;
          border-radius: 18px;
          background: linear-gradient(145deg, #191c25, #101218);
          color: #ffffff;
          font-family: inherit;
        }

        .ms-player-top {
          display: flex;
          align-items: center;
          gap: 15px;
          margin-bottom: 25px;
          min-width: 0;
        }

        .ms-player-cover {
          width: 56px;
          height: 56px;
          flex: 0 0 56px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 13px;
          background: linear-gradient(135deg, #343b4b, #171a23);
          color: #ffffff;
          font-size: 26px;
        }

        .ms-player-info {
          min-width: 0;
          flex: 1;
        }

        .ms-player-name {
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
          font-size: 15px;
          font-weight: 700;
        }

        .ms-player-caption {
          margin-top: 6px;
          color: #858b99;
          font-size: 12px;
        }

        .ms-player-play {
          width: 48px;
          height: 48px;
          flex: 0 0 48px;
          display: flex;
          align-items: center;
          justify-content: center;
          border: none;
          border-radius: 50%;
          background: #ffffff;
          color: #101218;
          font-size: 19px;
          cursor: pointer;
        }

        .ms-player-play:hover {
          background: #dddddd;
          transform: scale(1.05);
        }

        .ms-player-seek {
          appearance: none;
          -webkit-appearance: none;
          width: 100%;
          height: 6px;
          display: block;
          margin: 0;
          border: none;
          border-radius: 10px;
          outline: none;
          cursor: pointer;
        }

        .ms-player-seek::-webkit-slider-thumb {
          appearance: none;
          -webkit-appearance: none;
          width: 14px;
          height: 14px;
          border: none;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 0 0 3px rgba(255,255,255,0.12);
          transition: transform 0.15s ease;
        }

        .ms-player-seek::-webkit-slider-thumb:hover {
          transform: scale(1.2);
        }

        .ms-player-seek::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border: none;
          border-radius: 50%;
          background: #ffffff;
          box-shadow: 0 0 0 3px rgba(255,255,255,0.12);
        }

        .ms-player-times {
          display: flex;
          justify-content: space-between;
          margin-top: 12px;
          color: #9298a6;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }

        .ms-player-hint {
          margin-top: 16px;
          color: #686f7e;
          font-size: 11px;
        }

        .ms-timing-panel {
          width: 100%;
          max-width: 700px;
          margin: 18px 0;
          padding: 22px;
          box-sizing: border-box;
          border: 1px solid #303440;
          border-radius: 18px;
          background: #151821;
          color: #ffffff;
        }

        .ms-timing-top {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          margin-bottom: 18px;
          color: #9ca3af;
          font-size: 13px;
        }

        .ms-timing-current {
          min-height: 150px;
          display: flex;
          flex-direction: column;
          justify-content: center;
          align-items: center;
          padding: 24px 16px;
          margin-bottom: 18px;
          box-sizing: border-box;
          border: 1px solid #343b4b;
          border-radius: 14px;
          background: #1d2230;
          text-align: center;
        }

        .ms-timing-current-label {
          margin-bottom: 15px;
          color: #9298a6;
          font-size: 12px;
          text-transform: uppercase;
          letter-spacing: 1px;
        }

        .ms-timing-current-text {
          font-size: 24px;
          line-height: 1.4;
          font-weight: 700;
          overflow-wrap: anywhere;
        }

        .ms-timing-current-empty {
          color: #737b8b;
          font-size: 18px;
        }

        .ms-timing-main-button {
          width: 100%;
          min-height: 68px;
          padding: 18px;
          border: 1px solid #596174;
          border-radius: 13px;
          background: linear-gradient(145deg, #343b4b, #222735);
          color: #ffffff;
          font-size: 18px;
          font-weight: 800;
          letter-spacing: 0.4px;
          cursor: pointer;
          box-shadow:
            0 4px 16px rgba(0, 0, 0, 0.25),
            inset 0 1px 0 rgba(255, 255, 255, 0.08);
        }

        .ms-timing-main-button:hover:not(:disabled) {
          background: linear-gradient(145deg, #414b60, #2b3343);
          border-color: #8290aa;
          box-shadow: 0 5px 20px rgba(0, 0, 0, 0.3);
        }

        .ms-timing-main-button:active:not(:disabled) {
          transform: scale(0.98);
          background: #1b202b;
        }

        .ms-timing-main-button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
          box-shadow: none;
        }

        .ms-timing-controls {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
          margin-top: 12px;
        }

        .ms-timing-secondary {
          min-height: 48px;
          padding: 12px;
          border: 1px solid #3a4050;
          border-radius: 10px;
          background: #222735;
          color: #ffffff;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
        }

        .ms-timing-secondary:hover:not(:disabled) {
          background: #303747;
          border-color: #626d82;
        }

        .ms-timing-secondary:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        .ms-timing-undo {
          width: 100%;
          min-height: 46px;
          margin-top: 10px;
          padding: 12px;
          border: 1px solid #765b36;
          border-radius: 10px;
          background: #302719;
          color: #f4c77b;
          font-size: 14px;
          font-weight: 700;
          cursor: pointer;
        }

        .ms-timing-undo:hover:not(:disabled) {
          background: #40331f;
          border-color: #a17a45;
        }

        .ms-timing-undo:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        .ms-timing-list {
          display: flex;
          flex-direction: column;
          gap: 8px;
          width: 100%;
          max-width: 700px;
          padding: 0;
          margin: 18px 0;
          list-style: none;
        }

        .ms-timing-row {
          display: flex;
          align-items: center;
          gap: 12px;
          width: 100%;
          padding: 14px;
          box-sizing: border-box;
          border: 1px solid #303440;
          border-radius: 11px;
          background: #191d27;
          color: #ffffff;
          text-align: left;
          cursor: pointer;
          transition: border-color 0.15s ease, background 0.15s ease;
        }

        .ms-timing-row:hover {
          background: #222735;
          border-color: #50596b;
        }

        .ms-timing-row.selected {
          border: 2px solid #ffffff;
          background: #252b39;
        }

        .ms-timing-row.active {
          border-color: #22c55e;
        }

        .ms-timing-row-number {
          width: 30px;
          height: 30px;
          flex: 0 0 30px;
          display: flex;
          align-items: center;
          justify-content: center;
          border-radius: 8px;
          background: #303747;
          color: #ffffff;
          font-size: 12px;
          font-weight: 700;
        }

        .ms-timing-row-content {
          flex: 1;
          min-width: 0;
        }

        .ms-timing-row-text {
          font-size: 14px;
          line-height: 1.4;
          overflow-wrap: anywhere;
        }

        .ms-timing-row-time {
          margin-top: 5px;
          color: #9ca3af;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }

        .ms-timing-row-check {
          color: #4ade80;
          font-size: 18px;
          font-weight: 800;
        }

        .ms-timing-edit {
          display: flex;
          flex-wrap: wrap;
          align-items: center;
          gap: 8px;
          margin-top: 8px;
        }

        .ms-timing-edit input {
          width: 120px;
          min-height: 38px;
          padding: 6px 9px;
          box-sizing: border-box;
          border: 1px solid #444b5b;
          border-radius: 8px;
          background: #10131a;
          color: #ffffff;
        }

        .ms-timing-edit button {
          min-height: 38px;
          padding: 7px 10px;
          border: 1px solid #444b5b;
          border-radius: 8px;
          background: #252b39;
          color: #ffffff;
          cursor: pointer;
        }

        .ms-reset-timings {
          display: block;
          margin: 12px 0 18px;
          padding: 12px 18px;
          border: 1px solid #303440;
          border-radius: 10px;
          background: #151821;
          color: #b8bdc9;
          font-size: 13px;
          font-weight: 700;
          cursor: pointer;
        }

        .ms-reset-timings:hover:not(:disabled) {
          background: #202430;
          border-color: #596174;
          color: #ffffff;
        }

        .ms-reset-timings:active:not(:disabled) {
          background: #101218;
          transform: scale(0.97);
        }

        .ms-reset-timings:disabled {
          opacity: 0.35;
          cursor: not-allowed;
        }

        @media (max-width: 480px) {
          .ms-player {
            padding: 17px;
          }

          .ms-player-cover {
            width: 48px;
            height: 48px;
            flex-basis: 48px;
          }

          .ms-player-play {
            width: 44px;
            height: 44px;
            flex-basis: 44px;
          }

          .ms-timing-panel {
            padding: 15px;
          }

          .ms-timing-current {
            min-height: 130px;
            padding: 18px 12px;
          }

          .ms-timing-current-text {
            font-size: 21px;
          }

          .ms-timing-main-button {
            min-height: 62px;
            font-size: 16px;
          }

          .ms-timing-row {
            padding: 11px;
          }

          .ms-lyrics-editor {
            min-height: 110px;
            padding: 12px;
          }
        }
      `}</style>

      <button onClick={() => navigate('/')}>
        ← Назад к проектам
      </button>

      <h1>{project.name}</h1>

      <h2>Название проекта</h2>

      <input
        value={projectName}
        onChange={(event) => setProjectName(event.target.value)}
        maxLength={100}
      />

      <button
        onClick={handleSave}
        disabled={saving || !projectName.trim()}
      >
        {saving ? 'Сохранение...' : 'Сохранить название'}
      </button>

      <h2>Аудиофайл</h2>

      {!hasAudio ? (
        <div>
          <p>Загрузи песню MP3 или WAV.</p>

          <input
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            onChange={handleUploadAudio}
            disabled={uploading}
          />
        </div>
      ) : (
        <div>
          <audio
            ref={audioRef}
            src={audioUrl || undefined}
            preload="metadata"
            onEnded={(event) => {
              setPlaying(false)
              setCurrentTime(event.currentTarget.currentTime)
            }}
            onPlay={() => setPlaying(true)}
            onPause={(event) => {
              setPlaying(false)
              setCurrentTime(event.currentTarget.currentTime)
            }}
            onLoadedMetadata={(event) => {
              setCurrentTime(event.currentTarget.currentTime)
              setDuration(event.currentTarget.duration || 0)
            }}
            onDurationChange={(event) => {
              setDuration(event.currentTarget.duration || 0)
            }}
            style={{ display: 'none' }}
          />

          {audioUrl ? (
            <div className="ms-player">
              <div className="ms-player-top">
                <div className="ms-player-cover">♫</div>

                <div className="ms-player-info">
                  <div className="ms-player-name">
                    {cloudAudio?.name ?? audio?.name}
                  </div>

                  <div className="ms-player-caption">
                    {playing ? 'Сейчас играет' : 'Готово к воспроизведению'}
                  </div>
                </div>

                <button
                  className="ms-player-play"
                  onClick={() => void handlePlay()}
                  aria-label={playing ? 'Пауза' : 'Воспроизвести'}
                  title={playing ? 'Пауза' : 'Воспроизвести'}
                >
                  {playing ? 'Ⅱ' : '▶'}
                </button>
              </div>

              <input
                className="ms-player-seek"
                type="range"
                min={0}
                max={duration > 0 ? duration : 1}
                step={0.01}
                value={Math.min(currentTime, duration || 0)}
                onChange={(event) => handleSeek(event.target.value)}
                aria-label="Перемотка аудио"
                style={{
                  background: `linear-gradient(to right, #ffffff ${seekProgress}%, #343946 ${seekProgress}%)`,
                }}
              />

              <div className="ms-player-times">
                <span>{formatPlayerTime(currentTime)}</span>
                <span>{formatPlayerTime(duration)}</span>
              </div>

              <div className="ms-player-hint">
                Перемещай ползунок, чтобы перейти к нужному моменту песни
              </div>
            </div>
          ) : (
            <p>Загружаем аудио...</p>
          )}

          <p>Размер: {cloudAudio?.size ?? audio?.size}</p>

          <button onClick={handleRemoveAudio} disabled={uploading}>
            Удалить песню
          </button>

          <p>Заменить аудио:</p>

          <input
            type="file"
            accept=".mp3,.wav,audio/mpeg,audio/wav"
            onChange={handleUploadAudio}
            disabled={uploading}
          />

          {uploading && <p>Загрузка...</p>}
        </div>
      )}

      <h2>Текст песни</h2>

      <textarea
        className="ms-lyrics-editor"
        value={lyrics}
        onChange={(event) => handleLyricsChange(event.target.value)}
        placeholder="Вставь текст песни. Каждую строку пиши с новой строки."
        rows={5}
      />

      <p>
        Строк: {lyrics.split(/\r?\n/).filter((line) => line.trim()).length}
      </p>

      <button onClick={handleSaveLyrics} disabled={savingLyrics}>
        {savingLyrics ? 'Сохранение...' : 'Сохранить текст'}
      </button>

      <button onClick={handleGenerateLines}>
        Подготовить строки для синхронизации
      </button>

      <h2>Синхронизация текста</h2>

      <button
        className="ms-reset-timings"
        onClick={handleResetAllTimes}
        disabled={lines.length === 0 || synchronizedCount === 0 || savingSync}
      >
        СБРОСИТЬ ВСЕ ТАЙМИНГИ ({synchronizedCount})
      </button>

      <p>
        Включи песню. Выбери строку, дождись её начала и нажми
        «Поставить тайминг». После этого редактор перейдёт к следующей строке.
      </p>

      <h3>
        Синхронизировано: {synchronizedCount} / {lines.length}
      </h3>

      <h3>Текущее время: {formatTime(currentTime)}</h3>

      <button
        onClick={() => setShowKaraoke(true)}
        disabled={!audioUrl || synchronizedCount === 0}
        style={{
          display: 'block',
          width: '100%',
          maxWidth: '500px',
          marginTop: '15px',
          padding: '18px 24px',
          fontSize: '18px',
          fontWeight: 'bold',
          cursor: !audioUrl || synchronizedCount === 0
            ? 'not-allowed'
            : 'pointer',
          background: '#2563eb',
          color: '#ffffff',
          border: 'none',
          borderRadius: '10px',
        }}
      >
        ОТКРЫТЬ КАРАОКЕ
      </button>

      {lines.length === 0 ? (
        <p>Сначала сохрани текст и подготовь строки.</p>
      ) : (
        <>
          <div className="ms-timing-panel">
            <div className="ms-timing-top">
              <span>РЕЖИМ РАЗМЕТКИ</span>
              <strong>
                Строка {selectedLineIndex + 1} из {lines.length}
              </strong>
            </div>

            <div className="ms-timing-current">
              <div className="ms-timing-current-label">
                Выбранная строка
              </div>

              {selectedLine ? (
                <div className="ms-timing-current-text">
                  {selectedLine.text}
                </div>
              ) : (
                <div className="ms-timing-current-empty">
                  Выбери строку ниже
                </div>
              )}
            </div>

            <button
              className="ms-timing-main-button"
              onClick={handleCaptureLine}
              disabled={!audioUrl || !selectedLine || savingSync}
            >
              {savingSync
                ? 'СОХРАНЕНИЕ...'
                : '● ПОСТАВИТЬ ТАЙМИНГ'}
            </button>

            <div className="ms-timing-controls">
              <button
                className="ms-timing-secondary"
                onClick={handlePreviousLine}
                disabled={selectedLineIndex === 0}
              >
                ← Предыдущая
              </button>

              <button
                className="ms-timing-secondary"
                onClick={handleNextLine}
                disabled={selectedLineIndex >= lines.length - 1}
              >
                Следующая →
              </button>
            </div>

            <button
              className="ms-timing-undo"
              onClick={handleUndoTiming}
              disabled={!canUndoTiming}
            >
              ↶ Отменить последний тайминг
            </button>

            <p style={{ color: '#9298a6', fontSize: '12px', marginBottom: 0 }}>
              Текущее время трека: {formatTime(currentTime)}
            </p>
          </div>

          <h3>Все строки</h3>

          <p style={{ color: '#9298a6', fontSize: '13px' }}>
            Нажми на строку, чтобы выбрать её для разметки.
          </p>

          <ol className="ms-timing-list">
            {lines.map((line, index) => {
              const isActive = line.id === activeLineId
              const isSelected = index === selectedLineIndex

              return (
                <li key={line.id}>
                  <button
                    type="button"
                    className={`ms-timing-row${isSelected ? ' selected' : ''}${isActive ? ' active' : ''}`}
                    onClick={() => handleSelectLine(index)}
                  >
                    <span className="ms-timing-row-number">
                      {index + 1}
                    </span>

                    <span className="ms-timing-row-content">
                      <span className="ms-timing-row-text">
                        {line.text}
                      </span>

                      <span className="ms-timing-row-time">
                        {formatTime(line.time)}
                      </span>
                    </span>

                    {line.time !== null && (
                      <span className="ms-timing-row-check">✓</span>
                    )}

                    {isSelected && (
                      <span style={{ color: '#ffffff', fontSize: '11px' }}>
                        ВЫБРАНА
                      </span>
                    )}
                  </button>

                  <div className="ms-timing-edit">
                    <label style={{ color: '#9298a6', fontSize: '12px' }}>
                      Секунды:
                    </label>

                    <input
                      type="number"
                      min="0"
                      step="0.01"
                      value={line.time ?? ''}
                      placeholder="Не задан"
                      onChange={(event) =>
                        handleEditTime(index, event.target.value)
                      }
                    />

                    <button onClick={() => handleDeleteTime(index)}>
                      Сбросить
                    </button>
                  </div>
                </li>
              )
            })}
          </ol>
        </>
      )}

      <button
        onClick={() => void handleSaveSync()}
        disabled={savingSync}
      >
        {savingSync ? 'Сохранение...' : 'Сохранить синхронизацию'}
      </button>

      {message && <p>{message}</p>}
      {error && <p>{error}</p>}

      <h2>Удаление проекта</h2>

      {!confirmDelete ? (
        <button onClick={() => setConfirmDelete(true)}>
          Удалить проект
        </button>
      ) : (
        <div>
          <p>Ты действительно хочешь удалить этот проект?</p>

          <button onClick={handleDelete} disabled={deleting}>
            {deleting ? 'Удаление...' : 'Да, удалить'}
          </button>

          <button
            onClick={() => setConfirmDelete(false)}
            disabled={deleting}
          >
            Отмена
          </button>
        </div>
      )}

      {showKaraoke && (
        <KaraokePlayer
          lines={lines}
          currentTime={currentTime}
          audioRef={audioRef}
          playing={playing}
          onPlay={handlePlay}
          onClose={() => setShowKaraoke(false)}
        />
      )}
    </div>
  )
}
