
import {
  useEffect,
  useRef,
  useState,
  type ChangeEvent,
  type PointerEvent,
} from 'react'
import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import { telegram } from '../telegram/telegram'

type Mode = 'cover' | 'video'
type Template = 'classic' | 'karaoke'
type Format = '1:1' | '16:9' | '9:16'
type Quality = '720p' | '1080p' | '4K'
type Tab = 'files' | 'text' | 'karaoke' | 'background' | 'effects' | 'export'
type Effect = 'dust' | 'zoomIn' | 'zoomOut' | 'drift' | 'pulse' | 'glitch' | 'flicker' | 'blur'
type Position = { x: number; y: number }
type LyricLine = { time: number; text: string }

type Settings = {
  mode: Mode
  template: Template
  title: string
  artist: string
  font: string
  uppercase: boolean
  titleSize: number
  artistSize: number
  titlePosition: Position
  artistPosition: Position
  titleColor: string
  artistColor: string
  darkness: number
  imageScale: number
  imageX: number
  imageY: number
  effects: Effect[]
  effectSpeed: number
  effectStrength: number
  dustCount: number
  blurAmount: number
  coverRadius: number
  lyrics: LyricLine[]
  lyricSize: number
  lyricColor: string
  inactiveOpacity: number
  lyricX: number
  lyricY: number
  showProgress: boolean
  flashEnabled: boolean
  flashAuto: boolean
  flashTime: number
  outroAuto: boolean
  outroTime: number
  flashDuration: number
  flashIntensity: number
}

const dimensions: Record<Quality, Record<Format, [number, number]>> = {
  '720p': {
    '1:1': [720, 720],
    '16:9': [1280, 720],
    '9:16': [720, 1280],
  },
  '1080p': {
    '1:1': [1080, 1080],
    '16:9': [1920, 1080],
    '9:16': [1080, 1920],
  },
  '4K': {
    '1:1': [2160, 2160],
    '16:9': [3840, 2160],
    '9:16': [2160, 3840],
  },
}

const effectNames: Record<Effect, string> = {
  dust: 'Атмосферная пыль',
  zoomIn: 'Приближение',
  zoomOut: 'Отдаление',
  drift: 'Движение фона',
  pulse: 'Пульсация',
  glitch: 'RGB Glitch',
  flicker: 'Мерцание',
  blur: 'Blur Wave',
}

const fonts = [
  'Arial',
  'Verdana',
  'Impact',
  'Georgia',
  'Tahoma',
  'Trebuchet MS',
  'Times New Roman',
  'Courier New',
]

const clamp = (n: number, min: number, max: number) =>
  Math.min(max, Math.max(min, n))

function smoothStep(value: number) {
  const x = clamp(value, 0, 1)
  return x * x * (3 - 2 * x)
}

function formatTime(seconds: number) {
  const s = Math.floor(Math.max(0, Number.isFinite(seconds) ? seconds : 0))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

function parseLyrics(value: string): LyricLine[] {
  return value
    .split(/\r?\n/)
    .map((row) => {
      const m = row.match(
        /^\s*(?:(\d+):)?(\d{1,2})(?:[.,](\d+))?\s*[|–-]\s*(.+)$/,
      )
      if (!m) return null
      return {
        time: Number(m[1] || 0) * 60 + Number(m[2]) + Number(`0.${m[3] || '0'}`),
        text: m[4].trim(),
      }
    })
    .filter((x): x is LyricLine => x !== null && x.text.length > 0)
    .sort((a, b) => a.time - b.time)
}

// Готовые тайминги TXT/LRC/TTML импортируются без облачного ИИ.
function formatLyricTimestamp(seconds: number) {
  const safe = Math.max(0, Math.round(seconds * 100) / 100)
  const minutes = Math.floor(safe / 60)
  const remainder = (safe - minutes * 60).toFixed(2).padStart(5, '0')
  return `${minutes}:${remainder}`
}

function lyricsToEditorText(lines: LyricLine[]) {
  return [...lines]
    .sort((a, b) => a.time - b.time)
    .map((line) => `${formatLyricTimestamp(line.time)} | ${line.text}`)
    .join('\n')
}

// LRC: метаданные [ar:...], [offset:...] и несколько меток на одной строке.
function parseLrcFile(source: string): LyricLine[] {
  const result: LyricLine[] = []
  const offset = source.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/im)
  const offsetSeconds = offset ? Number(offset[1]) / 1000 : 0

  for (const row of source.split(/\r?\n/)) {
    const stamps = Array.from(row.matchAll(/\[(\d{1,3}):(\d{2})(?:[.,](\d{1,3}))?\]/g))
    if (!stamps.length) continue

    // Расширенный LRC может содержать время отдельных слов в угловых скобках.
    const text = row
      .replace(/\[\d{1,3}:\d{2}(?:[.,]\d{1,3})?\]/g, '')
      .replace(/<\d{1,3}:\d{2}(?:[.,]\d{1,3})?>/g, '')
      .trim()
    if (!text) continue

    for (const stamp of stamps) {
      const minutes = Number(stamp[1])
      const seconds = Number(stamp[2])
      if (seconds >= 60) continue
      const fraction = stamp[3] ? Number(`0.${stamp[3]}`) : 0
      const time = Math.max(0, minutes * 60 + seconds + fraction + offsetSeconds)
      result.push({ time, text })
    }
  }

  return result.sort((a, b) => a.time - b.time)
}

// TTML: временные значения вида 00:00:01.120, 01:23.45 и 2.5s.
function parseTtmlTime(raw: string): number | null {
  const value = raw.trim()
  const clock = value.match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[.,](\d+))?$/)
  if (clock) {
    const hours = clock[1] ? Number(clock[1]) : 0
    const minutes = Number(clock[2])
    const seconds = Number(clock[3])
    if (minutes >= 60 && clock[1] || seconds >= 60) return null
    return hours * 3600 + minutes * 60 + seconds + (clock[4] ? Number(`0.${clock[4]}`) : 0)
  }

  const unit = value.match(/^(\d+(?:[.,]\d+)?)(ms|h|m|s)$/i)
  if (unit) {
    const amount = Number(unit[1].replace(',', '.'))
    const scale: Record<string, number> = { ms: 0.001, s: 1, m: 60, h: 3600 }
    return amount * scale[unit[2].toLowerCase()]
  }
  return null
}

function parseTtmlFile(source: string): LyricLine[] {
  const xml = new DOMParser().parseFromString(source, 'application/xml')
  if (xml.getElementsByTagName('parsererror').length || xml.documentElement.localName !== 'tt') {
    throw new Error('Файл TTML содержит некорректный XML.')
  }

  const result: LyricLine[] = []
  const paragraphs = Array.from(xml.getElementsByTagName('*')).filter((element) => element.localName === 'p')
  for (const paragraph of paragraphs) {
    const text = (paragraph.textContent || '').replace(/\s+/g, ' ').trim()
    if (!text) continue

    // В некоторых TTML время есть только у вложенных span.
    const firstSpan = Array.from(paragraph.getElementsByTagName('*'))
      .find((element) => element.localName === 'span' && element.hasAttribute('begin'))
    const begin = paragraph.getAttribute('begin') || firstSpan?.getAttribute('begin')
    if (!begin) continue

    const time = parseTtmlTime(begin)
    if (time !== null && Number.isFinite(time) && time >= 0) {
      result.push({ time, text })
    }
  }
  return result.sort((a, b) => a.time - b.time)
}

function saveBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name.replace(/[\\/:*?"<>|]/g, '_')
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 60000)
}

function errorText(error: unknown) {
  return error instanceof Error ? error.message : String(error)
}

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement,
  x: number,
  y: number,
  size: number,
  radius: number,
) {
  const scale = Math.max(size / image.naturalWidth, size / image.naturalHeight)
  const iw = image.naturalWidth * scale
  const ih = image.naturalHeight * scale

  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, Math.min(radius, size / 3))
  ctx.clip()
  ctx.drawImage(image, x + (size - iw) / 2, y + (size - ih) / 2, iw, ih)
  ctx.restore()
}

function drawScene(
  ctx: CanvasRenderingContext2D,
  image: HTMLImageElement | null,
  s: Settings,
  time: number,
  duration: number,
) {
  const w = ctx.canvas.width
  const h = ctx.canvas.height
  const karaoke = s.mode === 'video' && s.template === 'karaoke'

  ctx.clearRect(0, 0, w, h)
  ctx.fillStyle = '#101014'
  ctx.fillRect(0, 0, w, h)

  const speed = s.effectSpeed / 50
  const strength = s.effectStrength / 50

  if (image?.complete && image.naturalWidth > 0) {
    const base = Math.max(w / image.naturalWidth, h / image.naturalHeight)
    let animationScale = karaoke ? 1.2 : 1

    if (s.effects.includes('zoomIn')) {
      animationScale *= 1 + (1 - Math.cos(time * speed * 0.45)) * 0.06 * strength
    }
    if (s.effects.includes('zoomOut')) {
      animationScale *= 1 + (1 + Math.cos(time * speed * 0.45)) * 0.06 * strength
    }
    if (s.effects.includes('pulse')) {
      animationScale *= 1.03 + Math.sin(time * speed * 1.5) * 0.025 * strength
    }

    const drift = s.effects.includes('drift')
    if (drift) animationScale *= 1 + 0.045 * strength

    const scale = base * s.imageScale * animationScale
    const iw = image.naturalWidth * scale
    const ih = image.naturalHeight * scale

    const dx = drift ? Math.sin(time * speed * 0.32) * w * 0.025 * strength : 0
    const dy = drift ? Math.cos(time * speed * 0.23) * h * 0.02 * strength : 0

    const x = (w - iw) / 2 + (s.imageX / 100) * w + dx
    const y = (h - ih) / 2 + (s.imageY / 100) * h + dy

    ctx.save()

    if (karaoke) {
      ctx.filter = `blur(${s.blurAmount * Math.min(w / 1280, h / 720)}px)`
    } else if (s.effects.includes('blur')) {
      const amount = (0.3 + (Math.sin(time * speed * 0.7) + 1) / 2) * 2.5
      ctx.filter = `blur(${amount * strength * (w / 1080)}px)`
    }

    ctx.drawImage(image, x, y, iw, ih)
    ctx.restore()

    if (!karaoke && s.effects.includes('glitch')) {
      const pulse = Math.pow(Math.max(0, Math.sin(time * speed * 3.3)), 12)
      const offset = pulse * 6 * strength * (w / 1080)

      if (offset > 0.1) {
        ctx.save()
        ctx.globalCompositeOperation = 'screen'
        ctx.globalAlpha = Math.min(0.35, pulse * 0.2)
        ctx.drawImage(image, x - offset, y, iw, ih)
        ctx.drawImage(image, x + offset, y, iw, ih)
        ctx.restore()
      }
    }
  }

  ctx.fillStyle = `rgba(0,0,0,${clamp(s.darkness / 100 + (karaoke ? 0.3 : 0), 0, 0.95)})`
  ctx.fillRect(0, 0, w, h)

  if (s.effects.includes('flicker')) {
    const v = Math.sin(time * 2.7) * 0.025 * strength
    ctx.fillStyle = v > 0 ? `rgba(255,255,255,${v})` : `rgba(0,0,0,${-v})`
    ctx.fillRect(0, 0, w, h)
  }

  if (s.effects.includes('dust')) {
    for (let i = 0; i < s.dustCount; i++) {
      const rx = Math.sin((i + 1) * 123.45) * 43758.5
      const ry = Math.sin((i + 1) * 456.78) * 12345.6
      const x = (rx - Math.floor(rx)) * w
      const origin = ry - Math.floor(ry)
      const y = ((((origin - time * (0.006 + (i % 8) * 0.002)) % 1) + 1) % 1) * h

      ctx.beginPath()
      ctx.fillStyle = 'rgba(255,245,230,0.25)'
      ctx.arc(x, y, (0.6 + (i % 5) * 0.35) * w / 1080, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  if (!karaoke) {
    const layers = [
      {
        text: s.title,
        size: s.titleSize,
        position: s.titlePosition,
        color: s.titleColor,
        weight: 'bold',
      },
      {
        text: s.artist,
        size: s.artistSize,
        position: s.artistPosition,
        color: s.artistColor,
        weight: 'normal',
      },
    ]

    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'

    for (const layer of layers) {
      if (!layer.text.trim()) continue

      const text = s.uppercase ? layer.text.toLocaleUpperCase('ru-RU') : layer.text
      ctx.save()
      ctx.font = `${layer.weight} ${layer.size * w / 1080}px "${s.font}", Arial`
      ctx.fillStyle = layer.color
      ctx.shadowColor = 'rgba(0,0,0,0.75)'
      ctx.shadowBlur = 12 * w / 1080
      ctx.fillText(text, layer.position.x * w / 100, layer.position.y * h / 100, w * 0.9)
      ctx.restore()
    }

    return
  }

  // Караоке: при появлении слов заголовок и исполнитель расположены
  // над обложкой, сама обложка немного ниже. Справа — текст по таймингам.
  const horizontal = w > h * 1.12
  const unit = Math.min(w / 1280, h / 720)
  const coverSize = horizontal
    ? Math.min(w * 0.345, h * 0.60)
    : Math.min(w * 0.61, h * 0.29)
  const coverX = horizontal ? w * 0.073 : (w - coverSize) / 2
  const coverY = horizontal ? h * 0.205 : h * 0.165

  // Сцены выбираются строго по времени аудио — одинаково в предпросмотре и MP4.
  const firstLyricTime = s.lyrics.length ? s.lyrics[0].time : Number.POSITIVE_INFINITY
  const flashMoment = s.flashAuto ? firstLyricTime : s.flashTime
  const hasIntro = s.lyrics.length > 0 && Number.isFinite(flashMoment) && flashMoment > 0.6
  // После последней фразы возвращаем вступительную композицию.
  // В таймингах есть начало фразы, но нет её конца: даём последней строке
  // примерно 3 секунды и не начинаем финал раньше перехода к караоке.
  const lastLyricTime = s.lyrics.length ? s.lyrics[s.lyrics.length - 1].time : 0
  const autoOutroMoment = s.lyrics.length && duration > 0
    ? Math.min(Math.max(lastLyricTime + 3, flashMoment + 1), Math.max(flashMoment + 1, duration - 2.5))
    : Number.POSITIVE_INFINITY
  const outroMoment = s.outroAuto ? autoOutroMoment
    : clamp(s.outroTime, Math.min(duration, flashMoment + 0.5), Math.max(duration, flashMoment + 0.5))
  const endingScene = time >= outroMoment
  const introScene = !s.lyrics.length || (hasIntro && time < flashMoment) || endingScene
  const sceneFade = endingScene ? 0 : hasIntro
    ? smoothStep(clamp((time - flashMoment) / Math.max(0.25, s.flashDuration * 0.65), 0, 1))
    : 1
  // Маскируем смену расположения коротким мягким затемнением.
  const outroSwitchFade = Number.isFinite(outroMoment)
    ? 1 - (1 - smoothStep(clamp(Math.abs(time - outroMoment) / 0.48, 0, 1)))
    : 1

  // Во вступлении обложка сверху по центру, тайминг прямо под ней.
  // После вспышки возвращаем привычную обложку слева.
  const introCoverSize = Math.min(w * (horizontal ? 0.30 : 0.59), h * (horizontal ? 0.38 : 0.30))
  const introCoverX = (w - introCoverSize) / 2
  const introCoverY = h * (horizontal ? 0.085 : 0.07)
  const shownCoverX = introScene ? introCoverX : coverX
  const shownCoverY = introScene ? introCoverY : coverY
  const shownCoverSize = introScene ? introCoverSize : coverSize

  if (image?.naturalWidth) {
    ctx.save()
    ctx.globalAlpha = introScene ? 1 : sceneFade
    drawImageCover(ctx, image, shownCoverX, shownCoverY, shownCoverSize, s.coverRadius * unit)
    ctx.restore()
  }

  // Только шкала времени и два таймкода — без кнопки, подложки и надписи.
  const barX = shownCoverX + 4 * unit
  const barY = shownCoverY + shownCoverSize + (introScene ? 19 : 34) * unit
  const barW = shownCoverSize - 8 * unit
  const ratio = clamp(time / Math.max(1, duration), 0, 1)

  ctx.save()
  ctx.globalAlpha = introScene ? 1 : sceneFade
  ctx.fillStyle = 'rgba(255,255,255,0.28)'
  ctx.beginPath()
  ctx.roundRect(barX, barY, barW, 3 * unit, 1.5 * unit)
  ctx.fill()

  if (ratio > 0) {
    ctx.fillStyle = '#ffffff'
    ctx.beginPath()
    ctx.roundRect(barX, barY, barW * ratio, 3 * unit, 1.5 * unit)
    ctx.fill()
  }

  ctx.font = `500 ${Math.max(10, 14 * unit)}px Arial, sans-serif`
  ctx.fillStyle = 'rgba(255,255,255,0.82)'
  ctx.textBaseline = 'top'
  ctx.textAlign = 'left'
  ctx.fillText(formatTime(time), barX, barY + 11 * unit)
  ctx.textAlign = 'right'
  ctx.fillText(formatTime(duration), barX + barW, barY + 11 * unit)
  ctx.restore()

  const textLeft = horizontal ? w * 0.445 : w * 0.075
  const textRight = horizontal ? w * 0.95 : w * 0.925
  const textWidth = textRight - textLeft
  const textCenter = (textLeft + textRight) / 2
  const coverCenterX = coverX + coverSize / 2
  const coverHeadingY = horizontal ? h * 0.082 : h * 0.072
  const artistHeadingY = horizontal ? h * 0.138 : h * 0.115
  const coverHeadingWidth = Math.min(coverSize * 1.1, horizontal ? w * 0.36 : w * 0.88)
  const lyricsTop = horizontal ? h * 0.255 : h * 0.585
  const lyricsBottom = h * (s.showProgress ? 0.88 : 0.95)
  const lyricsHeight = Math.max(1, lyricsBottom - lyricsTop)

  // Вступительный титр находится в центре всего кадра.
  if (introScene) {
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.globalAlpha = endingScene ? 1 : smoothStep(clamp(time / 1.15, 0, 1))
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 ${Math.max(26, 56 * unit)}px Arial, sans-serif`
    ctx.fillText(s.title || 'Название трека', w / 2, h * (horizontal ? 0.73 : 0.64), w * 0.86)
    ctx.fillStyle = 'rgba(255,255,255,0.78)'
    ctx.font = `500 ${Math.max(15, 26 * unit)}px Arial, sans-serif`
    ctx.fillText(s.artist || 'Исполнитель', w / 2, h * (horizontal ? 0.73 : 0.64) + 54 * unit, w * 0.84)
    ctx.restore()
  } else {
    // Основная сцена: название трека и исполнитель — непосредственно
    // над обложкой, а не над текстом справа.
    ctx.save()
    ctx.globalAlpha = sceneFade
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = '#ffffff'
    ctx.font = `800 ${Math.max(15, 32 * unit)}px Arial, sans-serif`
    ctx.fillText(s.title || 'Название трека', coverCenterX, coverHeadingY, coverHeadingWidth)
    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    ctx.font = `500 ${Math.max(12, 20 * unit)}px Arial, sans-serif`
    ctx.fillText(s.artist || 'Исполнитель', coverCenterX, artistHeadingY, coverHeadingWidth)
    ctx.restore()
  }

  const lines = s.lyrics
  if (introScene) {
    // До первой строки не показываем подсказки и будущие слова.
  } else if (!lines.length) {
    ctx.save()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle = 'rgba(255,255,255,0.65)'
    ctx.font = `600 ${Math.max(14, 24 * unit)}px Arial, sans-serif`
    ctx.fillText('Добавь текст во вкладке «Караоке»', textCenter, lyricsTop + lyricsHeight / 2, textWidth)
    ctx.restore()
  } else {
    const size = Math.max(15, s.lyricSize * unit)
    const normalFont = `700 ${size}px Arial, sans-serif`
    const activeScale = 1.24
    const rowHeight = size * 1.43
    const gap = size * 0.66
    const wrapWidth = textWidth / activeScale - 18 * unit

    // Строки переносим по словам; размеры блоков фиксированы.
    ctx.save()
    ctx.globalAlpha = sceneFade
    ctx.font = normalFont
    const wrapped = lines.map(({ text }) => {
      const words = text.trim().split(/\s+/).filter(Boolean)
      const result: string[] = []
      let row = ''
      for (const word of words) {
        const candidate = row ? `${row} ${word}` : word
        if (row && ctx.measureText(candidate).width > wrapWidth) {
          result.push(row)
          row = word
        } else {
          row = candidate
        }
      }
      if (row) result.push(row)
      return result.length ? result : ['']
    })

    const starts: number[] = []
    const heights: number[] = []
    let total = 0
    for (const parts of wrapped) {
      starts.push(total)
      const blockHeight = parts.length * rowHeight
      heights.push(blockHeight)
      total += blockHeight + gap
    }

    let activeIndex = -1
    for (let i = 0; i < lines.length; i++) {
      if (time >= lines[i].time) activeIndex = i
      else break
    }

    // Последняя строка растворяется после короткой выдержки.
    const lastTime = lines[lines.length - 1].time
    const outroStart = Math.min(lastTime + 3.2, outroMoment - 1.6)
    const lyricsFadeOut = 1 - smoothStep(clamp((time - outroStart) / 1.6, 0, 1))

    const focusIndex = Math.max(0, activeIndex)
    const anchor = (i: number) => starts[i] + heights[i] / 2
    const transitionDuration = 0.52
    const phase = activeIndex > 0
      ? clamp((time - lines[activeIndex].time) / transitionDuration, 0, 1)
      : 1
    const ease = phase * phase * (3 - 2 * phase)

    // Между таймингами позиция НЕ меняется. При смене строки —
    // один короткий плавный переход вместо постоянной прокрутки.
    const previousAnchor = anchor(Math.max(0, focusIndex - 1))
    const scrollPosition = activeIndex > 0
      ? previousAnchor + (anchor(focusIndex) - previousAnchor) * ease
      : anchor(0)
    const focusY = lyricsTop + lyricsHeight * 0.47

    ctx.beginPath()
    ctx.rect(textLeft, lyricsTop, textWidth, lyricsHeight)
    ctx.clip()
    ctx.textAlign = 'center'
    ctx.textBaseline = 'top'

    for (let i = Math.max(0, focusIndex - 4); i <= Math.min(lines.length - 1, focusIndex + 4); i++) {
      const top = focusY + starts[i] - scrollPosition
      const height = heights[i]
      if (top + height < lyricsTop - rowHeight || top > lyricsBottom + rowHeight) continue

      const isCurrent = i === focusIndex && activeIndex >= 0
      const isPrevious = i === focusIndex - 1 && activeIndex > 0
      const highlight = isCurrent ? ease : isPrevious ? 1 - ease : 0
      const scale = 1 + (activeScale - 1) * highlight
      const opacity = clamp(s.inactiveOpacity / 100, 0.12, 0.75)

      ctx.save()
      ctx.globalAlpha = sceneFade * lyricsFadeOut * (opacity + (1 - opacity) * highlight)
      ctx.fillStyle = highlight > 0 ? s.lyricColor : '#ffffff'
      ctx.font = normalFont
      const blockCenter = top + height / 2
      ctx.translate(textCenter, blockCenter)
      ctx.scale(scale, scale)
      for (let j = 0; j < wrapped[i].length; j++) {
        ctx.fillText(wrapped[i][j], 0, -height / 2 + j * rowHeight, wrapWidth)
      }
      ctx.restore()
    }
    ctx.restore()
  }

  // Управляемая вспышка: по первой строке либо в заданный момент.
  // В ручном режиме момент вспышки также управляет сменой раскладки.
  if (s.flashEnabled && hasIntro) {
    const half = s.flashDuration / 2
    const startDistance = Math.abs(time - flashMoment)
    const endDistance = Math.abs(time - outroMoment)
    const distance = Math.min(startDistance, endDistance)
    if (distance < half) {
      const intensity = 1 - distance / half
      ctx.save()
      ctx.globalAlpha = (s.flashIntensity / 100) * smoothStep(intensity)
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, w, h)
      ctx.restore()
    }
  }

  // В конце караоке переход к вступительной композиции скрывается
  // плавным затемнением на стыке, без скачка обложки и заголовков.
  if (outroSwitchFade < 1) {
    ctx.fillStyle = `rgba(0,0,0,${1 - outroSwitchFade})`
    ctx.fillRect(0, 0, w, h)
  }

  // Общее затемнение начала и конца — поверх всех элементов, включая обложку.
  const fadeIn = smoothStep(clamp(time / 1.15, 0, 1))
  const fadeOut = duration > 0
    ? smoothStep(clamp((duration - time) / 1.85, 0, 1))
    : 1
  const visibility = Math.min(fadeIn, fadeOut)
  if (visibility < 1) {
    ctx.fillStyle = `rgba(0,0,0,${1 - visibility})`
    ctx.fillRect(0, 0, w, h)
  }

}

function Slider({
  label,
  value,
  min,
  max,
  step = 1,
  suffix = '',
  disabled = false,
  onChange,
}: {
  label: string
  value: number
  min: number
  max: number
  step?: number
  suffix?: string
  disabled?: boolean
  onChange: (value: number) => void
}) {
  return (
    <div className="ms-slider">
      <div className="ms-slider-head">
        <span>{label}</span>
        <strong>{value}{suffix}</strong>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  )
}

export default function Video() {
  const [mode, setMode] = useState<Mode>('cover')
  const [template, setTemplate] = useState<Template>('classic')
  const [tab, setTab] = useState<Tab>('files')
  const [format, setFormat] = useState<Format>('1:1')
  const [quality, setQuality] = useState<Quality>('1080p')

  const [imageUrl, setImageUrl] = useState('')
  const [audioUrl, setAudioUrl] = useState('')
  const [imageName, setImageName] = useState('')
  const [audioName, setAudioName] = useState('')

  const [title, setTitle] = useState('')
  const [artist, setArtist] = useState('')
  const [font, setFont] = useState('Arial')
  const [uppercase, setUppercase] = useState(false)

  const [titleSize, setTitleSize] = useState(65)
  const [artistSize, setArtistSize] = useState(30)
  const [titlePosition, setTitlePosition] = useState<Position>({ x: 50, y: 69 })
  const [artistPosition, setArtistPosition] = useState<Position>({ x: 50, y: 80 })
  const [titleColor, setTitleColor] = useState('#ffffff')
  const [artistColor, setArtistColor] = useState('#ffffff')
  const [selectedLayer, setSelectedLayer] = useState<'title' | 'artist'>('title')

  const [darkness, setDarkness] = useState(25)
  const [imageScale, setImageScale] = useState(1)
  const [imageX, setImageX] = useState(0)
  const [imageY, setImageY] = useState(0)

  const [effects, setEffects] = useState<Effect[]>([])
  const [effectSpeed, setEffectSpeed] = useState(50)
  const [effectStrength, setEffectStrength] = useState(50)
  const [dustCount, setDustCount] = useState(90)

  const [lyricsInput, setLyricsInput] = useState('')
  const [plainLyrics, setPlainLyrics] = useState('')
  const [syncingLyrics, setSyncingLyrics] = useState(false)
  const [syncMessage, setSyncMessage] = useState('')

  const [lyricSize, setLyricSize] = useState(36)
  const [lyricColor, setLyricColor] = useState('#ffffff')
  const [inactiveOpacity, setInactiveOpacity] = useState(35)
  const [lyricX, setLyricX] = useState(71)
  const [lyricY, setLyricY] = useState(54)
  const [blurAmount, setBlurAmount] = useState(38)
  const [coverRadius, setCoverRadius] = useState(18)
  const [showProgress, setShowProgress] = useState(true)
  const [flashEnabled, setFlashEnabled] = useState(true)
  const [flashAuto, setFlashAuto] = useState(true)
  const [flashTime, setFlashTime] = useState(10)
  const [outroAuto, setOutroAuto] = useState(true)
  const [outroTime, setOutroTime] = useState(150)
  const [flashDuration, setFlashDuration] = useState(0.6)
  const [flashIntensity, setFlashIntensity] = useState(90)

  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [duration, setDuration] = useState(0)
  const [exporting, setExporting] = useState(false)
  const [progress, setProgress] = useState(0)
  const [status, setStatus] = useState('')

  const canvasRef = useRef<HTMLCanvasElement>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const imageRef = useRef<HTMLImageElement | null>(null)
  const imageUrlRef = useRef('')
  const audioUrlRef = useRef('')
  const audioFileRef = useRef<File | null>(null)
  const ffmpegRef = useRef<FFmpeg | null>(null)
  const recorderRef = useRef<MediaRecorder | null>(null)
  const cancelRef = useRef(false)

  const dragRef = useRef<{
    pointerId: number
    layer: 'title' | 'artist'
    offsetX: number
    offsetY: number
  } | null>(null)

  const [width, height] = dimensions[quality][format]
  const lyrics = parseLyrics(lyricsInput)
  const karaokeMode = mode === 'video' && template === 'karaoke'

  const settings: Settings = {
    mode, template, title, artist, font, uppercase,
    titleSize, artistSize, titlePosition, artistPosition,
    titleColor, artistColor, darkness, imageScale, imageX, imageY,
    effects, effectSpeed, effectStrength, dustCount, blurAmount,
    coverRadius, lyrics, lyricSize, lyricColor, inactiveOpacity,
    lyricX, lyricY, showProgress, flashEnabled, flashAuto,
    flashTime, outroAuto, outroTime, flashDuration, flashIntensity,
  }

  const settingsRef = useRef(settings)
  settingsRef.current = settings

  useEffect(() => {
    return () => {
      if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)
      if (recorderRef.current?.state === 'recording') recorderRef.current.stop()
      ffmpegRef.current?.terminate()
    }
  }, [])

  useEffect(() => {
    if (!imageUrl) {
      imageRef.current = null
      return
    }

    const image = new Image()
    image.onload = () => { imageRef.current = image }
    image.src = imageUrl

    return () => { image.onload = null }
  }, [imageUrl])

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    const previewWidth = Math.min(width, 1080)
    canvas.width = previewWidth
    canvas.height = Math.round(previewWidth * height / width)

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    let frame = 0
    const start = performance.now()

    const render = (now: number) => {
      const s = settingsRef.current
      const karaoke = s.mode === 'video' && s.template === 'karaoke'
      const time = karaoke
        ? audioRef.current?.currentTime || 0
        : (now - start) / 1000

      drawScene(ctx, imageRef.current, s, time, audioRef.current?.duration || 0)
      frame = requestAnimationFrame(render)
    }

    frame = requestAnimationFrame(render)
    return () => cancelAnimationFrame(frame)
  }, [width, height, imageUrl])

  function uploadImage(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    if (imageUrlRef.current) URL.revokeObjectURL(imageUrlRef.current)

    const url = URL.createObjectURL(file)
    imageUrlRef.current = url
    imageRef.current = null
    setImageUrl(url)
    setImageName(file.name)
  }

  function uploadAudio(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    audioRef.current?.pause()
    setPlaying(false)
    setCurrentTime(0)
    setDuration(0)

    if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current)

    const url = URL.createObjectURL(file)
    audioUrlRef.current = url
    audioFileRef.current = file

    setAudioUrl(url)
    setAudioName(file.name)
    setSyncMessage('')
  }

  async function uploadLyricsFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return

    try {
      if (file.size > 2 * 1024 * 1024) {
        throw new Error('Файл текста слишком большой (максимум 2 МБ).')
      }

      const source = (await file.text()).replace(/^\uFEFF/, '').trim()
      if (!source) throw new Error('Файл текста пустой.')

      const extension = file.name.split('.').pop()?.toLowerCase()
      let timedLines: LyricLine[] = []
      if (extension === 'lrc') {
        timedLines = parseLrcFile(source)
        if (!timedLines.length) throw new Error('В LRC не найдены строки с таймингами.')
      } else if (extension === 'ttml') {
        timedLines = parseTtmlFile(source)
        if (!timedLines.length) throw new Error('В TTML не найдены строки с временем начала.')
      } else if (extension === 'txt') {
        timedLines = parseLyrics(source)
        // TXT может содержать либо готовые тайминги, либо обычный текст.
        if (timedLines.length && timedLines.length !== source.split(/\r?\n/).filter((line) => line.trim()).length) {
          throw new Error('В TXT часть строк не соответствует формату «0:12.50 | Текст». Исправь строки или загрузи обычный текст.')
        }
      } else {
        throw new Error('Поддерживаются только файлы .txt, .lrc и .ttml.')
      }

      if (timedLines.length) {
        setLyricsInput(lyricsToEditorText(timedLines))
        setPlainLyrics(timedLines.map((line) => line.text).join('\n'))
        setSyncMessage(
          `Импортировано ${timedLines.length} строк с готовыми таймингами из ${file.name}. ` +
          'ИИ не запускался — проверь совпадение с версией аудиотрека.',
        )
      } else {
        setPlainLyrics(source)
        setLyricsInput('')
        setSyncMessage(`Загружен текст ${file.name} без таймингов. Теперь можно запустить ИИ-синхронизацию.`)
      }
    } catch (error) {
      setSyncMessage(`Ошибка импорта: ${errorText(error)}`)
    }
  }

  async function autoSyncLyrics() {
    if (syncingLyrics || exporting) return

    const audioFile = audioFileRef.current
    if (!audioFile) {
      setSyncMessage('Сначала загрузи музыкальный трек.')
      return
    }

    const source = (plainLyrics.trim() || lyricsInput.trim())
      .replace(/^\s*(?:(?:\d+):)?\d{1,2}(?:[.,]\d+)?\s*[|–-]\s*/gm, '')
      .trim()

    if (!source) {
      setSyncMessage('Добавь текст песни без таймингов.')
      return
    }

    if (audioFile.size > 30 * 1024 * 1024) {
      setSyncMessage('Максимальный размер аудио — 30 МБ.')
      return
    }

    // Используем данные, выданные Telegram WebApp, а не недоверенный user ID.
    // Без initData облачный сервер правильно отклонит запрос (HTTP 401).
    const initData = window.Telegram?.WebApp?.initData || telegram?.initData || ''
    if (!initData) {
      setSyncMessage(
        'Для автоматической синхронизации открой ЕДИНСТВО | MEDIA STUDIO внутри Telegram.',
      )
      return
    }

    setSyncingLyrics(true)
    setSyncMessage('ИИ анализирует песню в облаке. Это может занять несколько минут...')

    try {
      const form = new FormData()
      form.append('audio', audioFile)
      form.append('lyrics', source)
      form.append('telegram_init_data', initData)

      const apiUrl = 'https://fixkazya--edinstvo-media-studio-ai-create-web-app.us-east.modal.run'

      const response = await fetch(`${apiUrl}/api/sync-lyrics`, {
        method: 'POST',
        body: form,
      })

      const data = await response.json()

      if (response.status === 401) {
        throw new Error('Авторизация Telegram истекла или недействительна. Закрой и снова открой мини-приложение.')
      }

      if (response.status === 429) {
        throw new Error('ИИ сейчас занят другим треком. Попробуй снова позже.')
      }

      if (!response.ok || !data.success) {
        throw new Error(typeof data.detail === 'string'
          ? data.detail
          : typeof data.error === 'string'
            ? data.error
            : `Ошибка облачного сервера (HTTP ${response.status}).`)
      }

      if (typeof data.formatted_text !== 'string') {
        throw new Error('Сервер не вернул тайминги.')
      }

      const result = parseLyrics(data.formatted_text)
      if (!result.length) throw new Error('Не удалось разобрать тайминги.')

      setLyricsInput(data.formatted_text)
      setSyncMessage(
        `Готово! Синхронизировано ${result.length} строк. ` +
        'Проверь результат и при необходимости поправь время вручную.',
      )
    } catch (error) {
      console.error(error)
      setSyncMessage(
        error instanceof TypeError
          ? 'Нет соединения с облачным ИИ-сервером. Проверь интернет и попробуй снова.'
          : `Ошибка: ${errorText(error)}`,
      )
    } finally {
      setSyncingLyrics(false)
    }
  }

  async function togglePlay() {
    const audio = audioRef.current
    if (!audio) return

    if (!audio.paused) {
      audio.pause()
      return
    }

    try {
      await audio.play()
    } catch (error) {
      alert(errorText(error))
    }
  }

  function selectMode(next: Mode) {
    if (exporting) return
    setMode(next)
    if (next === 'cover') audioRef.current?.pause()
  }

  function selectTemplate(next: Template) {
    if (exporting) return
    setMode('video')
    setTemplate(next)

    if (next === 'karaoke') {
      setFormat('16:9')
      setLyricX(71)
      setLyricY(54)
      setTab('karaoke')
    }
  }

  function toggleEffect(effect: Effect) {
    setEffects((old) =>
      old.includes(effect) ? old.filter((item) => item !== effect) : [...old, effect],
    )
  }

  function pointerPosition(e: PointerEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current
    if (!canvas) return null
    const r = canvas.getBoundingClientRect()

    return {
      x: (e.clientX - r.left) / r.width * 100,
      y: (e.clientY - r.top) / r.height * 100,
    }
  }

  function pointerDown(e: PointerEvent<HTMLCanvasElement>) {
    if (exporting || karaokeMode) return

    const canvas = canvasRef.current
    const point = pointerPosition(e)
    if (!canvas || !point) return

    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const layers = [
      { id: 'title' as const, value: title, size: titleSize, position: titlePosition },
      { id: 'artist' as const, value: artist, size: artistSize, position: artistPosition },
    ]

    for (const layer of layers) {
      if (!layer.value) continue

      const size = layer.size * canvas.width / 1080
      ctx.font = `bold ${size}px "${font}", Arial`

      const textWidth = ctx.measureText(layer.value).width
      const dx = Math.abs((point.x - layer.position.x) * canvas.width / 100)
      const dy = Math.abs((point.y - layer.position.y) * canvas.height / 100)

      if (dx < textWidth / 2 + 25 && dy < size + 25) {
        dragRef.current = {
          pointerId: e.pointerId,
          layer: layer.id,
          offsetX: point.x - layer.position.x,
          offsetY: point.y - layer.position.y,
        }

        setSelectedLayer(layer.id)
        setTab('text')
        e.currentTarget.setPointerCapture(e.pointerId)
        return
      }
    }
  }

  function pointerMove(e: PointerEvent<HTMLCanvasElement>) {
    const drag = dragRef.current
    if (!drag || drag.pointerId !== e.pointerId) return

    const point = pointerPosition(e)
    if (!point) return

    const pos = {
      x: clamp(point.x - drag.offsetX, 0, 100),
      y: clamp(point.y - drag.offsetY, 0, 100),
    }

    if (drag.layer === 'title') setTitlePosition(pos)
    else setArtistPosition(pos)
  }

  function pointerUp(e: PointerEvent<HTMLCanvasElement>) {
    if (dragRef.current?.pointerId !== e.pointerId) return
    dragRef.current = null

    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }

  function downloadCover() {
    const image = imageRef.current
    if (!image?.naturalWidth) {
      alert('Сначала загрузи изображение.')
      return
    }

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    drawScene(ctx, image, { ...settingsRef.current, mode: 'cover' }, 0, 0)

    canvas.toBlob((blob) => {
      if (blob) saveBlob(blob, `${title || 'cover'}.png`)
    }, 'image/png')
  }

  function cancelExport() {
    cancelRef.current = true
    setStatus('Отмена экспорта...')

    if (recorderRef.current?.state === 'recording') {
      recorderRef.current.stop()
    }

    ffmpegRef.current?.terminate()
    ffmpegRef.current = null
  }

  async function sendExportToTelegram(mp4: Blob, ffmpeg: FFmpeg, audioDuration: number) {
    const initData = window.Telegram?.WebApp?.initData || telegram?.initData || ''
    if (!initData) throw new Error('Открой приложение внутри Telegram для отправки в чат.')

    const maxBytes = 19 * 1024 * 1024
    let uploadBlob = mp4

    if (uploadBlob.size > maxBytes) {
      setStatus('Готовим уменьшенную копию для Telegram...')
      // Ограничение по URL у Bot API: до 20 МБ. Целимся в 18 МБ с запасом.
      // Оригинал уже скачан и не изменяется.
      const targetBitsPerSecond = Math.floor(18 * 1024 * 1024 * 8 / Math.max(1, audioDuration))
      for (const [index, maxWidth] of [720, 480, 360].entries()) {
        if (cancelRef.current) return
        const audioBitrate = 64000
        const videoBitrate = Math.max(100000, Math.floor((targetBitsPerSecond - audioBitrate) * (0.82 - index * 0.09)))
        const output = `telegram-${index}.mp4`
        const code = await ffmpeg.exec([
          '-i', 'output.mp4',
          '-vf', `scale=min(${maxWidth}\,iw):-2`,
          '-c:v', 'libx264', '-preset', 'ultrafast',
          '-b:v', String(videoBitrate), '-maxrate', String(videoBitrate),
          '-bufsize', String(videoBitrate * 2),
          '-c:a', 'aac', '-b:a', '64k',
          '-movflags', '+faststart', output,
        ])
        if (code !== 0) continue
        const result = await ffmpeg.readFile(output)
        if (typeof result === 'string') continue
        uploadBlob = new Blob([new Uint8Array(result).slice().buffer], { type: 'video/mp4' })
        if (uploadBlob.size <= maxBytes) break
      }
      if (uploadBlob.size > maxBytes) {
        throw new Error('Видео сохранено на устройство, но не удалось сжать копию до 19 МБ для Telegram.')
      }
    }

    setStatus('Загружаем видео для Telegram...')
    const api = async (payload: Record<string, unknown>) => {
      const response = await fetch('/api/exports', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...payload, initData }),
      })
      const data: { success?: boolean; error?: string; signedUrl?: string; path?: string } = await response.json()
      if (!response.ok || !data.success) throw new Error(data.error || 'Ошибка сервера экспорта')
      return data
    }

    const created = await api({
      action: 'create-upload',
      fileName: 'music-video.mp4',
      fileSize: uploadBlob.size,
    })
    if (!created.signedUrl || !created.path) throw new Error('Не получена ссылка загрузки.')

    const upload = await fetch(created.signedUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'video/mp4' },
      body: uploadBlob,
    })
    if (!upload.ok) throw new Error(`Не удалось загрузить видео в облако (HTTP ${upload.status}).`)

    setStatus('Отправляем MP4 в Telegram...')
    await api({ action: 'send', path: created.path })
  }

  async function exportVideo() {
    if (exporting) return

    if (!audioUrl) {
      alert('Сначала загрузи музыкальный трек.')
      setTab('files')
      return
    }

    const image = imageRef.current

    if (!image?.naturalWidth) {
      alert('Сначала загрузи обложку.')
      setTab('files')
      return
    }

    if (!window.MediaRecorder || !HTMLCanvasElement.prototype.captureStream) {
      alert('Этот браузер не поддерживает запись видео.')
      return
    }

    if (quality === '4K' && !window.confirm(
      'Экспорт 4K требует много оперативной памяти. Продолжить?',
    )) return

    cancelRef.current = false
    setExporting(true)
    setProgress(0)
    setStatus('Подготовка видео...')

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height

    const ctx = canvas.getContext('2d', { alpha: false })
    if (!ctx) {
      setExporting(false)
      return
    }

    let audioContext: AudioContext | null = null
    let audio: HTMLAudioElement | null = null
    let stream: MediaStream | null = null
    let recorder: MediaRecorder | null = null
    let frame = 0

    const snapshot: Settings = {
      ...settingsRef.current,
      effects: [...settingsRef.current.effects],
      lyrics: [...settingsRef.current.lyrics],
    }

    try {
      const mime = [
        'video/webm;codecs=vp8,opus',
        'video/webm;codecs=vp9,opus',
        'video/webm',
      ].find((type) => MediaRecorder.isTypeSupported(type))

      if (!mime) throw new Error('WebM не поддерживается браузером.')

      audio = new Audio(audioUrl)
      audio.preload = 'auto'
      const exportAudio = audio

      await new Promise<void>((resolve, reject) => {
        exportAudio.onloadedmetadata = () => resolve()
        exportAudio.onerror = () => reject(new Error('Не удалось загрузить аудио.'))
      })

      const audioDuration = exportAudio.duration
      if (!Number.isFinite(audioDuration) || audioDuration <= 0) {
        throw new Error('Неверная длительность трека.')
      }

      if (cancelRef.current) return

      audioContext = new AudioContext()
      await audioContext.resume()

      const source = audioContext.createMediaElementSource(exportAudio)
      const destination = audioContext.createMediaStreamDestination()
      source.connect(destination)

      const videoStream = canvas.captureStream(30)
      stream = new MediaStream([
        ...videoStream.getVideoTracks(),
        ...destination.stream.getAudioTracks(),
      ])

      recorder = new MediaRecorder(stream, {
        mimeType: mime,
        videoBitsPerSecond:
          quality === '4K' ? 20000000 : quality === '1080p' ? 8000000 : 4000000,
      })

      const activeRecorder = recorder
      recorderRef.current = activeRecorder

      const chunks: Blob[] = []

      const recording = new Promise<Blob>((resolve, reject) => {
        activeRecorder.ondataavailable = (e) => {
          if (e.data.size) chunks.push(e.data)
        }
        activeRecorder.onerror = () => reject(new Error('Ошибка записи видео.'))
        activeRecorder.onstop = () =>
          resolve(new Blob(chunks, { type: 'video/webm' }))
      })

      const start = performance.now()

      const render = (now: number) => {
        if (cancelRef.current) return

        const time = snapshot.template === 'karaoke'
          ? exportAudio.currentTime
          : (now - start) / 1000

        drawScene(ctx, image, snapshot, time, audioDuration)
        setProgress(Math.min(70, Math.floor(exportAudio.currentTime / audioDuration * 70)))
        frame = requestAnimationFrame(render)
      }

      drawScene(ctx, image, snapshot, 0, audioDuration)
      activeRecorder.start(1000)
      frame = requestAnimationFrame(render)
      setStatus('Запись видео с музыкой...')

      await exportAudio.play()

      await new Promise<void>((resolve, reject) => {
        let finished = false

        const finish = () => {
          if (finished) return
          finished = true
          window.clearInterval(poll)
          resolve()
        }

        const fail = () => {
          if (finished) return
          finished = true
          window.clearInterval(poll)
          reject(new Error('Ошибка воспроизведения трека.'))
        }

        const poll = window.setInterval(() => {
          if (cancelRef.current || exportAudio.ended) finish()
        }, 300)

        exportAudio.addEventListener('ended', finish, { once: true })
        exportAudio.addEventListener('error', fail, { once: true })
      })

      cancelAnimationFrame(frame)

      if (activeRecorder.state !== 'inactive') activeRecorder.stop()
      const webm = await recording

      if (cancelRef.current) return
      if (!webm.size) throw new Error('Видео получилось пустым.')

      setProgress(72)
      setStatus('Загрузка кодировщика MP4...')

      const ffmpeg = new FFmpeg()
      ffmpegRef.current = ffmpeg

      ffmpeg.on('progress', ({ progress: value }) => {
        if (!cancelRef.current && Number.isFinite(value)) {
          setProgress(Math.min(99, 72 + clamp(value, 0, 1) * 27))
        }
      })

      const baseURL = 'https://cdn.jsdelivr.net/npm/@ffmpeg/core@0.12.10/dist/esm'
      const [coreURL, wasmURL] = await Promise.all([
        toBlobURL(`${baseURL}/ffmpeg-core.js`, 'text/javascript'),
        toBlobURL(`${baseURL}/ffmpeg-core.wasm`, 'application/wasm'),
      ])

      try {
        if (cancelRef.current) return
        await ffmpeg.load({ coreURL, wasmURL })
      } finally {
        URL.revokeObjectURL(coreURL)
        URL.revokeObjectURL(wasmURL)
      }

      if (cancelRef.current) return
      setStatus('Конвертация в MP4...')

      await ffmpeg.writeFile('input.webm', await fetchFile(webm))

      const exitCode = await ffmpeg.exec([
        '-i', 'input.webm',
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-crf', '23',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-movflags', '+faststart',
        'output.mp4',
      ])

      if (cancelRef.current) return
      if (exitCode !== 0) throw new Error(`FFmpeg завершился с кодом ${exitCode}.`)

      const data = await ffmpeg.readFile('output.mp4')
      if (typeof data === 'string') throw new Error('Ошибка чтения MP4.')

      const mp4 = new Blob(
        [new Uint8Array(data).slice().buffer],
        { type: 'video/mp4' },
      )

      if (!mp4.size) throw new Error('MP4 получился пустым.')

      saveBlob(
        mp4,
        `${title.trim() || 'music-video'}-${format.replace(':', 'x')}-${quality}.mp4`,
      )

      setProgress(100)
      setStatus('MP4 скачан. Отправляем в Telegram...')
      try {
        await sendExportToTelegram(mp4, ffmpeg, audioDuration)
        if (!cancelRef.current) setStatus('Готово! MP4 скачан и отправлен в Telegram.')
      } catch (sendError) {
        if (!cancelRef.current) {
          setStatus(`MP4 скачан. Telegram: ${errorText(sendError)}`)
        }
      }
    } catch (error) {
      if (!cancelRef.current) {
        console.error(error)
        setStatus(`Ошибка экспорта: ${errorText(error)}`)
      }
    } finally {
      cancelAnimationFrame(frame)
      audio?.pause()

      if (recorder && recorder.state === 'recording') recorder.stop()
      stream?.getTracks().forEach((track) => track.stop())

      if (audioContext) {
        await audioContext.close().catch(() => undefined)
      }

      recorderRef.current = null
      ffmpegRef.current?.terminate()
      ffmpegRef.current = null

      if (cancelRef.current) setStatus('Экспорт отменён.')
      setExporting(false)
    }
  }

  const selectedPosition = selectedLayer === 'title' ? titlePosition : artistPosition
  const selectedSize = selectedLayer === 'title' ? titleSize : artistSize

  const tabs: { id: Tab; label: string }[] = [
    { id: 'files', label: '▣ Файлы' },
    { id: 'text', label: 'T Текст' },
    { id: 'karaoke', label: '♫ Караоке' },
    { id: 'background', label: '◈ Фон' },
    { id: 'effects', label: '✦ Эффекты' },
    { id: 'export', label: '↓ Экспорт' },
  ]

  return (
    <div className="ms-root">
      <div className="ms-container">
        <header className="ms-header">
          <div>
            <div className="ms-brand">MEDIA STUDIO</div>
            <h1>Креативная студия</h1>
            <p>Создавай обложки, музыкальные видео и караоке</p>
          </div>

          <div className="ms-options">
            <button
              className={`ms-button ${mode === 'cover' ? 'active' : ''}`}
              disabled={exporting}
              onClick={() => selectMode('cover')}
            >◇ Обложка</button>
            <button
              className={`ms-button ${mode === 'video' ? 'active' : ''}`}
              disabled={exporting}
              onClick={() => selectMode('video')}
            >▷ Видео</button>
          </div>
        </header>

        <div className="ms-grid">
          <aside className="ms-panel">
            <div className="ms-tabs">
              {tabs.filter((item) =>
                mode === 'video' || (item.id !== 'karaoke' && item.id !== 'export'),
              ).map((item) => (
                <button
                  key={item.id}
                  className={`ms-tab ${tab === item.id ? 'active' : ''}`}
                  onClick={() => setTab(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>

            {tab === 'files' && (
              <section>
                <h2>Медиафайлы</h2>
                <p className="ms-muted">Добавь изображение и музыкальный трек.</p>

                <div className="ms-upload">
                  <div className="ms-upload-icon">▧</div>
                  <strong>Обложка / фон</strong>
                  <p>JPG, PNG, WEBP</p>
                  <label className="ms-upload-button">
                    ＋ {imageName ? 'Заменить изображение' : 'Добавить изображение'}
                    <input
                      type="file"
                      accept="image/*"
                      disabled={exporting}
                      onChange={uploadImage}
                      onClick={(e) => { e.currentTarget.value = '' }}
                    />
                  </label>
                  {imageName && <small>✓ {imageName}</small>}
                </div>

                {mode === 'video' && (
                  <>
                    <div className="ms-upload">
                      <div className="ms-upload-icon">♫</div>
                      <strong>Музыкальный трек</strong>
                      <p>MP3, WAV и другие аудиофайлы</p>
                      <label className="ms-upload-button">
                        ＋ {audioName ? 'Заменить музыку' : 'Добавить музыку'}
                        <input
                          type="file"
                          accept="audio/*"
                          disabled={exporting}
                          onChange={uploadAudio}
                          onClick={(e) => { e.currentTarget.value = '' }}
                        />
                      </label>
                      {audioName && <small>✓ {audioName}</small>}
                    </div>

                    <div className="ms-info">
                      <strong>Тип музыкального видео</strong>
                      <div className="ms-options">
                        <button
                          className={`ms-button ${template === 'classic' ? 'active' : ''}`}
                          onClick={() => selectTemplate('classic')}
                        >Обычное</button>
                        <button
                          className={`ms-button ${template === 'karaoke' ? 'active' : ''}`}
                          onClick={() => selectTemplate('karaoke')}
                        >♫ Караоке</button>
                      </div>
                    </div>
                  </>
                )}
              </section>
            )}

            {tab === 'text' && (
              <section>
                <h2>Название и исполнитель</h2>

                <label className="ms-label">
                  Название трека
                  <input value={title} disabled={exporting} onChange={(e) => setTitle(e.target.value)} placeholder="Название" />
                </label>

                <label className="ms-label">
                  Исполнитель
                  <input value={artist} disabled={exporting} onChange={(e) => setArtist(e.target.value)} placeholder="Исполнитель" />
                </label>

                <label className="ms-label">
                  Шрифт
                  <select value={font} disabled={exporting} onChange={(e) => setFont(e.target.value)}>
                    {fonts.map((f) => <option key={f} value={f}>{f}</option>)}
                  </select>
                </label>

                <label className="ms-check">
                  <input
                    type="checkbox"
                    checked={uppercase}
                    disabled={exporting}
                    onChange={(e) => setUppercase(e.target.checked)}
                  />
                  Все буквы заглавные
                </label>

                {!karaokeMode ? (
                  <>
                    <div className="ms-options">
                      <button className={`ms-button ${selectedLayer === 'title' ? 'active' : ''}`} onClick={() => setSelectedLayer('title')}>Название</button>
                      <button className={`ms-button ${selectedLayer === 'artist' ? 'active' : ''}`} onClick={() => setSelectedLayer('artist')}>Исполнитель</button>
                    </div>

                    <Slider
                      label="Размер"
                      value={selectedSize}
                      min={10}
                      max={200}
                      disabled={exporting}
                      onChange={selectedLayer === 'title' ? setTitleSize : setArtistSize}
                    />

                    <Slider
                      label="Позиция X"
                      value={selectedPosition.x}
                      min={0}
                      max={100}
                      disabled={exporting}
                      onChange={(x) =>
                        selectedLayer === 'title'
                          ? setTitlePosition((p) => ({ ...p, x }))
                          : setArtistPosition((p) => ({ ...p, x }))
                      }
                    />

                    <Slider
                      label="Позиция Y"
                      value={selectedPosition.y}
                      min={0}
                      max={100}
                      disabled={exporting}
                      onChange={(y) =>
                        selectedLayer === 'title'
                          ? setTitlePosition((p) => ({ ...p, y }))
                          : setArtistPosition((p) => ({ ...p, y }))
                      }
                    />

                    <label className="ms-label">
                      Цвет текста
                      <input
                        type="color"
                        value={selectedLayer === 'title' ? titleColor : artistColor}
                        disabled={exporting}
                        onChange={(e) =>
                          selectedLayer === 'title'
                            ? setTitleColor(e.target.value)
                            : setArtistColor(e.target.value)
                        }
                      />
                    </label>
                  </>
                ) : (
                  <div className="ms-info">
                    В караоке название и исполнитель располагаются автоматически.
                  </div>
                )}
              </section>
            )}

            {tab === 'karaoke' && (
              <section>
                <h2>Редактор караоке</h2>
                <p className="ms-muted">
                  Импортируй готовые тайминги TXT, LRC или TTML либо синхронизируй текст через ИИ.
                </p>

                <div className="ms-options">
                  <button className={`ms-button ${template === 'classic' ? 'active' : ''}`} disabled={exporting} onClick={() => selectTemplate('classic')}>Обычное</button>
                  <button className={`ms-button ${template === 'karaoke' ? 'active' : ''}`} disabled={exporting} onClick={() => selectTemplate('karaoke')}>♫ Караоке</button>
                </div>

                <div className="ms-info">
                  <strong>✨ Автосинхронизация ИИ</strong>
                  <p>
                    Если у тебя только текст без времени, загрузи аудио во вкладке «Файлы»
                    и запусти ИИ. Если есть готовый LRC или TTML, просто импортируй файл.
                  </p>

                  <label className="ms-label">
                    Текст песни для ИИ (без таймингов)
                    <textarea
                      rows={7}
                      value={plainLyrics}
                      disabled={exporting || syncingLyrics}
                      placeholder={'Первая строка\nВторая строка\nТретья строка'}
                      onChange={(e) => setPlainLyrics(e.target.value)}
                    />
                  </label>

                  <label className="ms-upload-button">
                    ＋ Импорт TXT / LRC / TTML
                    <input
                      type="file"
                      accept=".txt,.lrc,.ttml,text/plain,application/ttml+xml,application/xml,text/xml"
                      disabled={exporting || syncingLyrics}
                      onChange={uploadLyricsFile}
                      onClick={(e) => { e.currentTarget.value = '' }}
                    />
                  </label>

                  <button
                    className="ms-button active ms-wide"
                    disabled={exporting || syncingLyrics}
                    onClick={autoSyncLyrics}
                  >
                    {syncingLyrics ? '⏳ Анализ трека...' : '✨ Автосинхронизация'}
                  </button>

                  {syncMessage && <p className="ms-muted" role="status">{syncMessage}</p>}

                  <p className="ms-muted">
                    ИИ работает в облаке Modal. Файлы LRC и TTML с готовыми таймингами
                    импортируются без ИИ. Время строк можно изменить вручную.
                  </p>
                </div>

                <label className="ms-label">
                  Строки с таймингами
                  <textarea
                    rows={9}
                    value={lyricsInput}
                    disabled={exporting}
                    placeholder={'0:00 | Первая строка\n0:04.5 | Вторая строка\n0:08 | Третья строка'}
                    onChange={(e) => setLyricsInput(e.target.value)}
                  />
                </label>

                <p className="ms-muted">Формат: 0:12.5 | Текст строки</p>
                <div className="ms-info">Строк с таймингами: <strong>{lyrics.length}</strong></div>

                <Slider label="Размер текста" value={lyricSize} min={14} max={90} disabled={exporting} onChange={setLyricSize} />

                <label className="ms-label">
                  Цвет активной строки
                  <input type="color" value={lyricColor} disabled={exporting} onChange={(e) => setLyricColor(e.target.value)} />
                </label>

                <Slider label="Видимость соседних строк" value={inactiveOpacity} min={0} max={100} suffix="%" disabled={exporting} onChange={setInactiveOpacity} />
                <Slider label="Позиция X" value={lyricX} min={10} max={90} suffix="%" disabled={exporting} onChange={setLyricX} />
                <Slider label="Позиция Y" value={lyricY} min={10} max={90} suffix="%" disabled={exporting} onChange={setLyricY} />
                <Slider label="Размытие фона" value={blurAmount} min={0} max={100} disabled={exporting} onChange={setBlurAmount} />
                <Slider label="Закругление обложки" value={coverRadius} min={0} max={60} disabled={exporting} onChange={setCoverRadius} />

                <label className="ms-check">
                  <input
                    type="checkbox"
                    checked={showProgress}
                    disabled={exporting}
                    onChange={(e) => setShowProgress(e.target.checked)}
                  />
                  Показывать шкалу воспроизведения
                </label>
              </section>
            )}

            {tab === 'background' && (
              <section>
                <h2>Настройки фона</h2>
                <Slider label="Затемнение" value={darkness} min={0} max={90} suffix="%" disabled={exporting} onChange={setDarkness} />
                <Slider label="Масштаб" value={imageScale} min={0.5} max={3} step={0.01} disabled={exporting} onChange={setImageScale} />
                <Slider label="Позиция X" value={imageX} min={-100} max={100} disabled={exporting} onChange={setImageX} />
                <Slider label="Позиция Y" value={imageY} min={-100} max={100} disabled={exporting} onChange={setImageY} />
                {karaokeMode && (
                  <div className="ms-info">В караоке используется увеличенная и размытая обложка.</div>
                )}
              </section>
            )}

            {tab === 'effects' && (
              <section>
                <h2>Эффекты</h2>
                <p className="ms-muted">Можно включить несколько эффектов одновременно.</p>
                <div className="ms-effects">
                  {(Object.keys(effectNames) as Effect[]).map((effect) => (
                    <label className="ms-effect" key={effect}>
                      <span>{effectNames[effect]}</span>
                      <input
                        type="checkbox"
                        checked={effects.includes(effect)}
                        disabled={exporting}
                        onChange={() => toggleEffect(effect)}
                      />
                    </label>
                  ))}
                </div>
                {karaokeMode && (
                  <div className="ms-info">
                    <strong>✦ Белая вспышка и смена сцены</strong>
                    <label className="ms-check">
                      <input type="checkbox" checked={flashEnabled} disabled={exporting}
                        onChange={(e) => setFlashEnabled(e.target.checked)} />
                      Включить белую вспышку
                    </label>
                    <label className="ms-check">
                      <input type="checkbox" checked={flashAuto} disabled={exporting}
                        onChange={(e) => setFlashAuto(e.target.checked)} />
                      Автоматически по первой строке (начало)
                    </label>
                    {!flashAuto && (
                      <Slider label="Момент смены сцены" value={flashTime} min={0} max={Math.max(10, Math.ceil(duration || 180))}
                        step={0.1} suffix=" сек" disabled={exporting} onChange={setFlashTime} />
                    )}
                    <label className="ms-check">
                      <input type="checkbox" checked={outroAuto} disabled={exporting}
                        onChange={(e) => setOutroAuto(e.target.checked)} />
                      Автоматически после последней строки (конец)
                    </label>
                    {!outroAuto && (
                      <Slider label="Конец караоке" value={outroTime} min={0} max={Math.max(10, Math.ceil(duration || 180))}
                        step={0.1} suffix=" сек" disabled={exporting} onChange={setOutroTime} />
                    )}
                    {flashEnabled && (
                      <>
                        <Slider label="Длительность вспышки" value={flashDuration} min={0.1} max={3}
                          step={0.1} suffix=" сек" disabled={exporting} onChange={setFlashDuration} />
                        <Slider label="Яркость вспышки" value={flashIntensity} min={0} max={100}
                          suffix="%" disabled={exporting} onChange={setFlashIntensity} />
                      </>
                    )}
                    <p className="ms-muted">В ручном режиме указанное время задаёт и вспышку, и переход от вступления к караоке.</p>
                  </div>
                )}
                <Slider label="Скорость эффектов" value={effectSpeed} min={1} max={100} disabled={exporting} onChange={setEffectSpeed} />
                <Slider label="Сила эффектов" value={effectStrength} min={1} max={100} disabled={exporting} onChange={setEffectStrength} />
                {effects.includes('dust') && (
                  <Slider label="Количество частиц" value={dustCount} min={10} max={250} disabled={exporting} onChange={setDustCount} />
                )}
              </section>
            )}

            {tab === 'export' && (
              <section>
                <h2>Экспорт MP4</h2>
                <p className="ms-muted">Сохрани видео с обложкой, эффектами, караоке и музыкой.</p>

                <label className="ms-label">
                  Качество видео
                  <select
                    value={quality}
                    disabled={exporting}
                    onChange={(e) => setQuality(e.target.value as Quality)}
                  >
                    <option value="720p">720p</option>
                    <option value="1080p">1080p</option>
                    <option value="4K">4K</option>
                  </select>
                </label>

                <div className="ms-info">
                  <strong>Формат:</strong> {format}
                  <p>Разрешение: {width} × {height}</p>
                  <p>Тип: {template === 'karaoke' ? 'Караоке' : 'Музыкальное видео'}</p>
                </div>

                {!exporting ? (
                  <button className="ms-button active ms-wide" onClick={exportVideo}>
                    ↓ Скачать MP4
                  </button>
                ) : (
                  <button className="ms-button ms-wide" onClick={cancelExport}>
                    Отменить экспорт
                  </button>
                )}

                {(exporting || status) && (
                  <div className="ms-info">
                    <div className="ms-progress">
                      <div style={{ width: `${progress}%` }} />
                    </div>
                    <strong>{Math.round(progress)}%</strong>
                    <p>{status}</p>
                  </div>
                )}

                <p className="ms-muted">
                  Сначала видео записывается в реальном времени,
                  затем конвертируется в MP4.
                </p>
              </section>
            )}
          </aside>

          <main className="ms-panel">
            <h2>Предпросмотр</h2>
            <p className="ms-muted">
              {karaokeMode ? 'Музыкальное караоке' : mode === 'cover' ? 'Редактор обложки' : 'Музыкальное видео'}
            </p>

            {mode === 'video' && (
              <div className="ms-options">
                <button className={`ms-button ${template === 'classic' ? 'active' : ''}`} disabled={exporting} onClick={() => selectTemplate('classic')}>Обычное видео</button>
                <button className={`ms-button ${template === 'karaoke' ? 'active' : ''}`} disabled={exporting} onClick={() => selectTemplate('karaoke')}>♫ Караоке</button>
              </div>
            )}

            <div className="ms-options">
              {(['1:1', '16:9', '9:16'] as Format[]).map((value) => (
                <button
                  key={value}
                  className={`ms-button ${format === value ? 'active' : ''}`}
                  disabled={exporting}
                  onClick={() => setFormat(value)}
                >
                  {value}
                </button>
              ))}
            </div>

            <div className="ms-canvas-container">
              <canvas
                ref={canvasRef}
                className="ms-canvas"
                onPointerDown={pointerDown}
                onPointerMove={pointerMove}
                onPointerUp={pointerUp}
                onPointerCancel={pointerUp}
              />
            </div>

            <p className="ms-muted">
              {karaokeMode
                ? 'Строки меняются по таймингам при воспроизведении музыки.'
                : 'Название и исполнителя можно перемещать мышкой или пальцем.'}
            </p>

            {mode === 'video' && (
              <div className="ms-player">
                <audio
                  ref={audioRef}
                  src={audioUrl || undefined}
                  preload="metadata"
                  onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
                  onTimeUpdate={(e) => setCurrentTime(e.currentTarget.currentTime)}
                  onEnded={() => setPlaying(false)}
                  onPlay={() => setPlaying(true)}
                  onPause={() => setPlaying(false)}
                />

                <button
                  className="ms-play"
                  disabled={!audioUrl || exporting}
                  onClick={togglePlay}
                >
                  {playing ? 'Ⅱ' : '▶'}
                </button>

                <span className="ms-time">{formatTime(currentTime)}</span>

                <input
                  type="range"
                  min={0}
                  max={Number.isFinite(duration) ? duration : 0}
                  step={0.01}
                  value={clamp(currentTime, 0, Number.isFinite(duration) ? duration : 0)}
                  disabled={!audioUrl || exporting}
                  onChange={(e) => {
                    const value = Number(e.target.value)
                    if (audioRef.current) audioRef.current.currentTime = value
                    setCurrentTime(value)
                  }}
                />

                <span className="ms-time">{formatTime(duration)}</span>
              </div>
            )}

            {karaokeMode && audioUrl && Number.isFinite(duration) && duration > 0 && (
              <div style={{ marginTop: 14, padding: '12px 14px', background: '#191922', border: '1px solid #343444', borderRadius: 12 }}>
                <strong style={{ fontSize: 13 }}>✦ Таймлайн переходов — начало и конец</strong>
                <p className="ms-muted">Два маркера: фиолетовый — начало караоке, голубой — конец. Перетаскивай каждый отдельно.</p>
                {([
                  { id: 'start', name: 'Начало караоке', color: '#a875ff',
                    value: flashAuto ? (lyrics[0]?.time ?? 0) : flashTime,
                    auto: flashAuto,
                    change: (v: number) => { setFlashAuto(false); setFlashTime(Math.min(v, outroAuto ? (lyrics[lyrics.length - 1]?.time ?? duration) : outroTime - 0.5)) },
                    reset: () => setFlashAuto(true) },
                  { id: 'end', name: 'Конец караоке', color: '#67d5ff',
                    value: outroAuto
                      ? Math.min(Math.max((lyrics[lyrics.length - 1]?.time ?? 0) + 3,
                          (flashAuto ? (lyrics[0]?.time ?? 0) : flashTime) + 1),
                          Math.max((flashAuto ? (lyrics[0]?.time ?? 0) : flashTime) + 1, duration - 2.5))
                      : outroTime,
                    auto: outroAuto,
                    change: (v: number) => {
                      setOutroAuto(false)
                      setOutroTime(Math.max(v, (flashAuto ? (lyrics[0]?.time ?? 0) : flashTime) + 0.5))
                    },
                    reset: () => setOutroAuto(true) },
                ] as const).map((marker) => (
                  <div key={marker.id} style={{ marginTop: 14 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, fontSize: 12 }}>
                      <span style={{ color: marker.color, fontWeight: 700 }}>{marker.name}</span>
                      <span>{formatTime(marker.value)} {marker.auto ? '· авто' : '· вручную'}</span>
                    </div>
                    <div style={{ position: 'relative', height: 34, display: 'flex', alignItems: 'center' }}>
                      <div style={{ position: 'absolute', left: 0, right: 0, height: 5, borderRadius: 5, background: '#424252', pointerEvents: 'none' }} />
                      {lyrics.map((line, index) => (
                        <div key={`${marker.id}-${index}`} title={`Строка ${index + 1}: ${formatTime(line.time)}`}
                          style={{ position: 'absolute', left: `${clamp(line.time / duration * 100, 0, 100)}%`, top: 9, height: 16, width: 2, background: '#7b7b92', pointerEvents: 'none' }} />
                      ))}
                      <div style={{ position: 'absolute', left: `${clamp(currentTime / duration * 100, 0, 100)}%`, top: 5, height: 24, width: 2, background: '#fff', pointerEvents: 'none' }} />
                      <input type="range" min={0} max={duration} step={0.05}
                        value={clamp(marker.value, 0, duration)}
                        disabled={exporting}
                        aria-label={`Переместить: ${marker.name}`}
                        onChange={(e) => marker.change(Number(e.target.value))}
                        style={{ position: 'absolute', left: 0, width: '100%', margin: 0, accentColor: marker.color, cursor: 'ew-resize', background: 'transparent' }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#9999aa' }}>
                      <span>0:00</span><span>{formatTime(duration)}</span>
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                      <button className="ms-button" disabled={exporting} onClick={marker.reset}>Автоматически</button>
                      <button className="ms-button" disabled={exporting} onClick={() => marker.change(currentTime)}>
                        Поставить здесь ({formatTime(currentTime)})
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}

            {mode === 'cover' ? (
              <button className="ms-button active ms-wide" onClick={downloadCover}>
                ↓ Скачать PNG
              </button>
            ) : (
              <button
                className="ms-button active ms-wide"
                disabled={exporting}
                onClick={() => setTab('export')}
              >
                ↓ Экспортировать видео
              </button>
            )}
          </main>
        </div>
      </div>

      <style>{`
        .ms-root {
          min-height: 100vh;
          background: #101014;
          color: #f5f5fa;
          padding: 24px 16px 60px;
          font-family: Arial, sans-serif;
          box-sizing: border-box;
        }

        .ms-root * {
          box-sizing: border-box;
        }

        .ms-container {
          max-width: 1500px;
          margin: 0 auto;
        }

        .ms-header {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 20px;
          margin-bottom: 26px;
        }

        .ms-brand {
          font-size: 12px;
          font-weight: 800;
          letter-spacing: 3px;
          color: #a78bfa;
          margin-bottom: 8px;
        }

        .ms-header h1 {
          font-size: 28px;
          margin: 0 0 8px;
        }

        .ms-header p,
        .ms-muted {
          color: #aaa9bc;
          font-size: 13px;
          line-height: 1.6;
        }

        .ms-grid {
          display: grid;
          grid-template-columns: minmax(310px, 400px) minmax(0, 1fr);
          gap: 20px;
          align-items: start;
        }

        .ms-panel {
          background: #19191f;
          border: 1px solid #343440;
          border-radius: 18px;
          padding: 20px;
          min-width: 0;
        }

        .ms-panel h2 {
          font-size: 19px;
          margin: 0 0 12px;
        }

        .ms-tabs {
          display: flex;
          flex-wrap: wrap;
          gap: 7px;
          margin-bottom: 24px;
        }

        .ms-button,
        .ms-tab {
          background: #24242d;
          border: 1px solid #343440;
          border-radius: 11px;
          padding: 11px 14px;
          color: #f5f5fa;
          font-size: 13px;
          font-weight: 600;
          cursor: pointer;
          transition: background .2s, border-color .2s;
        }

        .ms-tab {
          flex: 1 0 auto;
          padding: 10px 9px;
          font-size: 12px;
        }

        .ms-button:hover:not(:disabled),
        .ms-tab:hover:not(:disabled) {
          border-color: #885cff;
        }

        .ms-button.active,
        .ms-tab.active {
          background: linear-gradient(135deg, #885cff, #6540db);
          border-color: #885cff;
          color: white;
        }

        .ms-button:disabled,
        .ms-tab:disabled {
          opacity: .5;
          cursor: not-allowed;
        }

        .ms-wide {
          width: 100%;
          padding: 14px;
          margin-top: 12px;
        }

        .ms-options {
          display: flex;
          flex-wrap: wrap;
          gap: 8px;
          margin: 14px 0;
        }

        .ms-options .ms-button {
          flex: 1 1 auto;
        }

        .ms-upload {
          text-align: center;
          background: #202029;
          border: 1px dashed #51516a;
          border-radius: 15px;
          padding: 23px 16px;
          margin: 16px 0;
        }

        .ms-upload-icon {
          font-size: 30px;
          color: #885cff;
          margin-bottom: 10px;
        }

        .ms-upload strong {
          display: block;
          margin-bottom: 8px;
        }

        .ms-upload p {
          color: #aaa9bc;
          font-size: 12px;
        }

        .ms-upload small {
          display: block;
          margin-top: 12px;
          word-break: break-all;
          color: #b7a4ff;
        }

        .ms-upload-button {
          display: inline-block;
          position: relative;
          overflow: hidden;
          padding: 12px 17px;
          margin-top: 8px;
          background: linear-gradient(135deg, #885cff, #6540db);
          color: white;
          font-weight: 700;
          border-radius: 11px;
          cursor: pointer;
          font-size: 13px;
        }

        .ms-upload-button input {
          position: absolute;
          inset: 0;
          width: 100%;
          opacity: 0;
          cursor: pointer;
        }

        .ms-label {
          display: block;
          color: #f5f5fa;
          font-size: 13px;
          font-weight: 600;
          margin: 18px 0;
        }

        .ms-label input:not([type="color"]),
        .ms-label select,
        .ms-label textarea {
          display: block;
          width: 100%;
          margin-top: 9px;
          background: #24242d;
          border: 1px solid #343440;
          border-radius: 10px;
          color: #f5f5fa;
          padding: 12px;
          font-family: inherit;
          font-size: 14px;
          outline: none;
        }

        .ms-label textarea {
          resize: vertical;
          line-height: 1.6;
          min-height: 160px;
        }

        .ms-label input[type="color"] {
          display: block;
          width: 100%;
          height: 42px;
          margin-top: 9px;
          background: #24242d;
          border: 1px solid #343440;
          border-radius: 10px;
          padding: 4px;
          cursor: pointer;
        }

        .ms-check {
          display: flex;
          align-items: center;
          gap: 10px;
          margin: 20px 0;
          font-size: 13px;
          cursor: pointer;
        }

        .ms-check input,
        .ms-effect input,
        .ms-slider input,
        .ms-player input {
          accent-color: #885cff;
        }

        .ms-slider {
          margin: 20px 0;
        }

        .ms-slider-head {
          display: flex;
          justify-content: space-between;
          gap: 12px;
          font-size: 13px;
          margin-bottom: 10px;
        }

        .ms-slider-head strong {
          color: #b6a4ff;
        }

        .ms-slider input {
          width: 100%;
        }

        .ms-info {
          background: #22212f;
          border: 1px solid #393449;
          padding: 14px;
          border-radius: 12px;
          margin: 18px 0;
          color: #d9d5e9;
          font-size: 13px;
          line-height: 1.6;
        }

        .ms-info p {
          margin: 10px 0;
        }

        .ms-effects {
          display: flex;
          flex-direction: column;
          gap: 8px;
          margin: 18px 0;
        }

        .ms-effect {
          display: flex;
          justify-content: space-between;
          align-items: center;
          gap: 12px;
          background: #24242d;
          border: 1px solid #343440;
          border-radius: 10px;
          padding: 13px;
          font-size: 13px;
          cursor: pointer;
        }

        .ms-canvas-container {
          display: flex;
          justify-content: center;
          align-items: center;
          min-height: 280px;
          overflow: hidden;
          padding: 12px;
          background: #0b0b10;
          border: 1px solid #343440;
          border-radius: 14px;
        }

        .ms-canvas {
          display: block;
          width: auto;
          height: auto;
          max-width: 100%;
          max-height: 68vh;
          object-fit: contain;
          cursor: grab;
          touch-action: none;
        }

        .ms-canvas:active {
          cursor: grabbing;
        }

        .ms-player {
          display: flex;
          align-items: center;
          gap: 12px;
          background: #22222a;
          border: 1px solid #343440;
          border-radius: 13px;
          padding: 13px;
          margin-top: 18px;
        }

        .ms-play {
          width: 42px;
          height: 42px;
          flex-shrink: 0;
          border: none;
          border-radius: 50%;
          color: #fff;
          background: #885cff;
          font-size: 17px;
          cursor: pointer;
        }

        .ms-play:disabled {
          opacity: .4;
        }

        .ms-player input[type="range"] {
          flex: 1;
          min-width: 0;
        }

        .ms-time {
          color: #c9c7d2;
          font-size: 12px;
          font-variant-numeric: tabular-nums;
        }

        .ms-progress {
          height: 8px;
          background: #3b3948;
          border-radius: 8px;
          overflow: hidden;
          margin-bottom: 12px;
        }

        .ms-progress div {
          height: 100%;
          background: linear-gradient(90deg, #885cff, #bd9fff);
          transition: width .2s;
        }

        @media (max-width: 950px) {
          .ms-grid {
            grid-template-columns: 1fr;
          }

          .ms-panel {
            padding: 16px;
          }
        }

        @media (max-width: 600px) {
          .ms-root {
            padding: 15px 10px 40px;
          }

          .ms-header {
            align-items: stretch;
            flex-direction: column;
          }

          .ms-header h1 {
            font-size: 23px;
          }

          .ms-canvas-container {
            min-height: 220px;
            padding: 6px;
          }

          .ms-player {
            gap: 6px;
            padding: 10px 7px;
          }

          .ms-time {
            font-size: 10px;
          }
        }
      `}</style>
    </div>
  )
}
