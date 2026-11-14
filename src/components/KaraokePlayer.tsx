
import { useEffect, useMemo, useRef, useState, type RefObject, type ChangeEvent } from 'react'

export type KaraokeLine = {
  id: number
  text: string
  time: number | null
}

type Props = {
  lines: KaraokeLine[]
  currentTime: number
  audioRef: RefObject<HTMLAudioElement | null>
  playing: boolean
  onPlay: () => void
  onClose: () => void
}

export default function KaraokePlayer({
  lines,
  currentTime,
  audioRef,
  playing,
  onPlay,
  onClose,
}: Props) {
  const viewportRef = useRef<HTMLDivElement>(null)

  const manualScrollRef = useRef(false)
  const scrollTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const animationRef = useRef<number | null>(null)
  const displayPositionRef = useRef<number | null>(null)
  const lastAudioTimeRef = useRef<number | null>(null)
  const latestTimeRef = useRef(currentTime)
  const lineElementsRef = useRef<(HTMLButtonElement | null)[]>([])
  const [duration, setDuration] = useState(0)

  const timedLines = useMemo(
    () => lines
      .filter((line) => line.time !== null)
      .sort((a, b) => (a.time ?? 0) - (b.time ?? 0)),
    [lines],
  )

  latestTimeRef.current = currentTime

  const foundIndex = timedLines.findIndex((line, index) => {
    const next = timedLines[index + 1]

    return (
      (line.time ?? 0) <= currentTime &&
      (!next || (next.time ?? 0) > currentTime)
    )
  })

  const activeIndex =
    foundIndex >= 0
      ? foundIndex
      : timedLines.length > 0 &&
          currentTime >= (timedLines[timedLines.length - 1].time ?? 0)
        ? timedLines.length - 1
        : -1


  useEffect(() => {
    const audio = audioRef.current
    if (!audio) return

    const updateDuration = () => {
      setDuration(Number.isFinite(audio.duration) ? audio.duration : 0)
    }

    updateDuration()

    audio.addEventListener('loadedmetadata', updateDuration)
    audio.addEventListener('durationchange', updateDuration)

    return () => {
      audio.removeEventListener('loadedmetadata', updateDuration)
      audio.removeEventListener('durationchange', updateDuration)
    }
  }, [audioRef])

  // Положение строки интерполируется по времени аудио, а само движение
  // сглаживается без резких прыжков при смене активной строки.
  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return

    let previousFrame = 0

    const animate = (timestamp: number) => {
      const elapsed = previousFrame ? Math.min(50, timestamp - previousFrame) : 16
      previousFrame = timestamp

      const audio = audioRef.current
      const audioTime = audio && Number.isFinite(audio.currentTime)
        ? audio.currentTime
        : latestTimeRef.current
      const elements = lineElementsRef.current
      const count = timedLines.length

      if (!manualScrollRef.current && count > 0) {
        let left = 0
        while (
          left < count - 1 &&
          (timedLines[left + 1].time ?? Infinity) <= audioTime
        ) {
          left += 1
        }

        const right = Math.min(count - 1, left + 1)
        const leftElement = elements[left]
        const rightElement = elements[right]

        if (leftElement && rightElement) {
          const leftTime = timedLines[left].time ?? 0
          const rightTime = timedLines[right].time ?? leftTime
          const span = rightTime - leftTime
          const ratio = span > 0
            ? Math.max(0, Math.min(1, (audioTime - leftTime) / span))
            : 0

          const leftCenter = leftElement.offsetTop + leftElement.offsetHeight / 2
          const rightCenter = rightElement.offsetTop + rightElement.offsetHeight / 2
          const center = leftCenter + (rightCenter - leftCenter) * ratio
          const maxScroll = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
          const desired = Math.max(0, Math.min(maxScroll, center - viewport.clientHeight / 2))

          const previousAudioTime = lastAudioTimeRef.current
          const seeked = previousAudioTime !== null &&
            (audioTime < previousAudioTime - 0.35 || audioTime > previousAudioTime + 1.25)
          lastAudioTimeRef.current = audioTime

          if (displayPositionRef.current === null || seeked) {
            displayPositionRef.current = desired
          } else {
            // Лёгкое сглаживание мелких неточностей currentTime.
            // Плавность не зависит от частоты обновления React.
            const factor = 1 - Math.exp(-elapsed / 130)
            displayPositionRef.current += (desired - displayPositionRef.current) * factor
          }

          viewport.scrollTop = displayPositionRef.current
        }
      } else {
        // После ручной прокрутки продолжаем от текущего положения.
        displayPositionRef.current = viewport.scrollTop
        lastAudioTimeRef.current = audioTime
      }

      animationRef.current = requestAnimationFrame(animate)
    }

    animationRef.current = requestAnimationFrame(animate)

    return () => {
      if (animationRef.current !== null) {
        cancelAnimationFrame(animationRef.current)
        animationRef.current = null
      }
    }
  }, [audioRef, timedLines])

  useEffect(() => {
    return () => {
      if (scrollTimerRef.current !== null) {
        clearTimeout(scrollTimerRef.current)
      }
    }
  }, [])

  function handleManualScroll() {
    manualScrollRef.current = true
    displayPositionRef.current = viewportRef.current?.scrollTop ?? null

    if (scrollTimerRef.current !== null) {
      clearTimeout(scrollTimerRef.current)
    }

    scrollTimerRef.current = setTimeout(() => {
      manualScrollRef.current = false
      displayPositionRef.current = viewportRef.current?.scrollTop ?? null
    }, 3000)
  }

  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onClose()
        return
      }

      if (
        event.target instanceof HTMLButtonElement ||
        event.target instanceof HTMLInputElement ||
        event.target instanceof HTMLTextAreaElement
      ) {
        return
      }

      if (event.code === 'Space') {
        event.preventDefault()
        onPlay()
      }

      if (event.code === 'ArrowLeft' && audioRef.current) {
        audioRef.current.currentTime = Math.max(
          0,
          audioRef.current.currentTime - 5,
        )
      }

      if (event.code === 'ArrowRight' && audioRef.current) {
        audioRef.current.currentTime = Math.min(
          audioRef.current.duration || Infinity,
          audioRef.current.currentTime + 5,
        )
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [onClose, onPlay, audioRef])

  function seekToLine(time: number | null) {
    if (time === null || !audioRef.current) return
    audioRef.current.currentTime = time
  }

  function handleSeek(event: ChangeEvent<HTMLInputElement>) {
    const audio = audioRef.current
    if (!audio || !Number.isFinite(audio.duration)) return

    audio.currentTime = Number(event.target.value)
  }

  const progress =
    duration > 0
      ? Math.min(100, Math.max(0, (currentTime / duration) * 100))
      : 0

  function formatTime(value: number) {
    if (!Number.isFinite(value) || value < 0) return '00:00'

    const minutes = Math.floor(value / 60)
    const seconds = Math.floor(value % 60)

    return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
  }

  return (
    <div className="karaoke">
      <style>{`
        .karaoke {
          position: fixed;
          inset: 0;
          z-index: 99999;
          background:
            radial-gradient(ellipse at 50% 48%, #151720 0%, #08090d 65%);
          color: white;
          display: flex;
          flex-direction: column;
          padding: clamp(18px, 4vw, 42px);
          box-sizing: border-box;
          font-family: inherit;
          animation: karaokeFadeIn 0.35s ease both;
          overflow: hidden;
        }

        @keyframes karaokeFadeIn {
          from { opacity: 0; }
          to { opacity: 1; }
        }

        .karaoke-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 12px;
          position: relative;
          z-index: 2;
          flex: none;
        }

        .karaoke-brand {
          display: flex;
          flex-direction: column;
          gap: 5px;
        }

        .karaoke-title {
          color: #f0f0f4;
          font-size: 13px;
          letter-spacing: 2px;
          font-weight: 800;
        }

        .karaoke-subtitle {
          color: #666b78;
          font-size: 11px;
          letter-spacing: 1px;
        }

        .karaoke-main {
          flex: 1;
          min-height: 0;
          width: 100%;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 18px 0;
          box-sizing: border-box;
        }

        .karaoke-panel {
          width: min(100%, 760px);
          height: 100%;
          min-height: 0;
          position: relative;
          overflow: hidden;
          border: 1px solid rgba(255,255,255,0.10);
          border-radius: 24px;
          background: linear-gradient(
            145deg,
            rgba(30,33,44,0.96),
            rgba(15,17,24,0.96)
          );
          box-shadow:
            0 20px 60px rgba(0,0,0,0.28),
            inset 0 1px 0 rgba(255,255,255,0.035);
        }

        .karaoke-scroll {
          width: 100%;
          height: 100%;
          overflow-x: hidden;
          overflow-y: auto;
          scroll-behavior: auto;
          overscroll-behavior: contain;
          -webkit-overflow-scrolling: touch;
          scrollbar-width: none;
          mask-image: linear-gradient(
            to bottom,
            transparent,
            black 13%,
            black 87%,
            transparent
          );
          -webkit-mask-image: linear-gradient(
            to bottom,
            transparent,
            black 13%,
            black 87%,
            transparent
          );
        }

        .karaoke-scroll::-webkit-scrollbar {
          display: none;
        }

        .karaoke-lyrics {
          position: relative;
          width: 100%;
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 2px;
          padding: 42vh 14px;
          box-sizing: border-box;
        }

        .karaoke-line {
          appearance: none;
          display: block;
          flex: none;
          width: 100%;
          max-width: 650px;
          box-sizing: border-box;
          padding: 12px 14px;
          border: 1px solid transparent;
          border-radius: 13px;
          outline: none;
          background: transparent;
          color: #777b89;
          font-family: inherit;
          font-size: clamp(19px, 3vw, 32px);
          font-weight: 700;
          line-height: 1.25;
          text-align: center;
          overflow-wrap: anywhere;
          opacity: 0.42;
          transform: scale(0.985);
          cursor: pointer;
          transition:
            color 600ms ease,
            opacity 600ms ease,
            transform 500ms ease,
            background 600ms ease,
            border-color 600ms ease;
          -webkit-tap-highlight-color: transparent;
        }

        .karaoke-line.active {
          color: #ffffff;
          opacity: 1;
          transform: scale(1);
          background: rgba(255,255,255,0.075);
          border-color: rgba(255,255,255,0.09);
          text-shadow: 0 0 25px rgba(255,255,255,0.08);
        }

        .karaoke-footer {
          position: relative;
          z-index: 2;
          width: 100%;
          flex: none;
          padding-top: 12px;
        }

        .karaoke-time {
          display: flex;
          justify-content: space-between;
          color: #858997;
          font-size: 12px;
          margin-bottom: 10px;
          font-variant-numeric: tabular-nums;
        }

        .karaoke-seek {
          appearance: none;
          display: block;
          width: 100%;
          height: 5px;
          margin: 0 0 20px;
          padding: 0;
          border: none;
          border-radius: 20px;
          outline: none;
          cursor: pointer;
          touch-action: pan-y;
          background: linear-gradient(
            to right,
            #ffffff 0%,
            #ffffff ${progress}%,
            #292c36 ${progress}%,
            #292c36 100%
          );
        }

        .karaoke-seek::-webkit-slider-thumb {
          appearance: none;
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: #ffffff;
          border: none;
          box-shadow: 0 0 12px rgba(255,255,255,0.3);
        }

        .karaoke-seek::-moz-range-thumb {
          width: 15px;
          height: 15px;
          border-radius: 50%;
          background: #ffffff;
          border: none;
          box-shadow: 0 0 12px rgba(255,255,255,0.3);
        }

        .karaoke-controls {
          display: flex;
          justify-content: center;
          align-items: center;
        }

        .karaoke-button {
          display: flex;
          justify-content: center;
          align-items: center;
          background: #191c25;
          color: #ffffff;
          border: 1px solid #303440;
          padding: 13px 20px;
          border-radius: 13px;
          font-family: inherit;
          font-size: 14px;
          font-weight: 600;
          cursor: pointer;
          transition:
            transform 180ms ease,
            background 180ms ease,
            border-color 180ms ease;
          -webkit-tap-highlight-color: transparent;
        }

        .karaoke-button:active {
          transform: scale(0.95);
        }

        .karaoke-play {
          min-width: 170px;
          padding: 16px 28px;
          background: #ffffff;
          color: #08090d;
          border-color: #ffffff;
          font-size: 14px;
          font-weight: 900;
          letter-spacing: 0.5px;
        }

        .karaoke-close {
          padding: 10px 16px;
          color: #c4c6ce;
        }

        @media (hover: hover) {
          .karaoke-button:hover {
            background: #272b37;
            border-color: #505666;
          }

          .karaoke-play:hover {
            background: #dedfe3;
          }
        }

        @media (max-width: 600px) {
          .karaoke {
            padding: 16px;
          }

          .karaoke-title {
            font-size: 11px;
            letter-spacing: 1px;
          }

          .karaoke-subtitle {
            font-size: 9px;
          }

          .karaoke-button {
            padding: 12px 13px;
            font-size: 12px;
          }

          .karaoke-play {
            min-width: 145px;
            padding: 15px 16px;
          }

          .karaoke-main {
            padding: 14px 0;
          }

          .karaoke-panel {
            width: 100%;
            border-radius: 19px;
          }

          .karaoke-lyrics {
            padding: 42vh 10px;
            gap: 1px;
          }

          .karaoke-line {
            padding: 11px 9px;
            font-size: clamp(18px, 5vw, 25px);
          }

          .karaoke-footer {
            padding-bottom: env(safe-area-inset-bottom);
          }
        }

        @media (prefers-reduced-motion: reduce) {
          .karaoke,
          .karaoke-line,
          .karaoke-button {
            animation-duration: 0.01ms;
            transition-duration: 0.01ms;
          }
        }
      `}</style>

      <header className="karaoke-header">
        <div className="karaoke-brand">
          <strong className="karaoke-title">
            MEDIA STUDIO / KARAOKE
          </strong>
          <span className="karaoke-subtitle">
            {playing ? 'СЕЙЧАС ИГРАЕТ' : 'ВОСПРОИЗВЕДЕНИЕ'}
          </span>
        </div>

        <button
          className="karaoke-button karaoke-close"
          onClick={onClose}
        >
          ✕ Закрыть
        </button>
      </header>

      <main className="karaoke-main">
        <div className="karaoke-panel">
          <div
            className="karaoke-scroll"
            ref={viewportRef}
            onTouchStart={handleManualScroll}
            onTouchMove={handleManualScroll}
            onWheel={handleManualScroll}
            onPointerDown={handleManualScroll}
          >
            <div className="karaoke-lyrics">
              {timedLines.length === 0 ? (
                <div className="karaoke-line active">
                  Сначала настрой тайминги строк
                </div>
              ) : (
                timedLines.map((line, index) => (
                  <button
                    type="button"
                    key={line.id}
                    ref={(element) => { lineElementsRef.current[index] = element }}
                    className={`karaoke-line ${
                      index === activeIndex ? 'active' : ''
                    }`}
                    onClick={() => seekToLine(line.time)}
                    title="Перейти к этой строке"
                  >
                    {line.text}
                  </button>
                ))
              )}
            </div>
          </div>
        </div>
      </main>

      <footer className="karaoke-footer">
        <div className="karaoke-time">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>

        <input
          className="karaoke-seek"
          type="range"
          min={0}
          max={duration || 1}
          step={0.1}
          value={Math.min(currentTime, duration || 1)}
          onChange={handleSeek}
          aria-label="Перемотка аудио"
        />

        <div className="karaoke-controls">
          <button
            className="karaoke-button karaoke-play"
            onClick={onPlay}
          >
            {playing ? 'Ⅱ ПАУЗА' : '▶ ИГРАТЬ'}
          </button>
        </div>
      </footer>
    </div>
  )
}
