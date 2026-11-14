
import { useEffect, useRef, useState, type ChangeEvent } from 'react'

import {
  saveSound,
  getSounds,
  deleteStoredSound,
  type StoredSound,
} from '../services/audioStorage'

type SoundItem = StoredSound & {
  url: string
}

export default function Sounds() {
  const [sounds, setSounds] = useState<SoundItem[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [showFavorites, setShowFavorites] = useState(false)
  const [sortBy, setSortBy] = useState('newest')

  const urls = useRef<Map<number, string>>(new Map())

  useEffect(() => {
    async function loadSounds() {
      try {
        const savedSounds = await getSounds()

        const items = await Promise.all(
          savedSounds.map(async (sound) => {
            const normalizedSound = {
              ...sound,
              favorite: sound.favorite ?? false,
            }

            await saveSound(normalizedSound)

            const url = URL.createObjectURL(sound.file)
            urls.current.set(sound.id, url)

            return { ...normalizedSound, url }
          })
        )

        setSounds(items)
      } catch (error) {
        console.error('Ошибка загрузки звуков:', error)
      } finally {
        setLoading(false)
      }
    }

    loadSounds()

    return () => {
      urls.current.forEach((url) => URL.revokeObjectURL(url))
      urls.current.clear()
    }
  }, [])

  async function addSound(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? [])
    event.target.value = ''

    for (const file of files) {
      if (!file.type.startsWith('audio/')) continue

      const sound: StoredSound = {
        id: Date.now() + Math.random(),
        name: file.name,
        size: (file.size / (1024 * 1024)).toFixed(2) + ' MB',
        file,
        favorite: false,
      }

      try {
        await saveSound(sound)

        const url = URL.createObjectURL(file)
        urls.current.set(sound.id, url)

        setSounds((previous) => [
          ...previous,
          { ...sound, url },
        ])
      } catch (error) {
        console.error('Ошибка сохранения звука:', error)
      }
    }
  }

  async function toggleFavorite(id: number) {
    const sound = sounds.find((item) => item.id === id)

    if (!sound) return

    const updatedSound = {
      ...sound,
      favorite: !sound.favorite,
    }

    try {
      const { url: _url, ...soundToSave } = updatedSound
      await saveSound(soundToSave)

      setSounds((previous) =>
        previous.map((item) =>
          item.id === id ? updatedSound : item
        )
      )
    } catch (error) {
      console.error('Ошибка изменения избранного:', error)
    }
  }

  async function removeSound(id: number) {
    try {
      await deleteStoredSound(id)

      const url = urls.current.get(id)

      if (url) {
        URL.revokeObjectURL(url)
        urls.current.delete(id)
      }

      setSounds((previous) =>
        previous.filter((sound) => sound.id !== id)
      )
    } catch (error) {
      console.error('Ошибка удаления звука:', error)
    }
  }

  const filteredSounds = sounds
    .filter((sound) => {
      const matchesSearch = sound.name
        .toLowerCase()
        .includes(search.toLowerCase())

      const matchesFavorite = !showFavorites || sound.favorite

      return matchesSearch && matchesFavorite
    })
    .sort((a, b) => {
      if (sortBy === 'name') {
        return a.name.localeCompare(b.name, 'ru')
      }

      if (sortBy === 'size') {
        return Number.parseFloat(b.size) - Number.parseFloat(a.size)
      }

      return b.id - a.id
    })

  return (
    <div>
      <h1>Мои звуки</h1>
      <p>Музыкальная библиотека</p>

      <label>
        <span>Добавить аудиофайлы</span>
        <input
          type="file"
          accept="audio/*"
          multiple
          onChange={addSound}
        />
      </label>

      <h2>Моя библиотека ({sounds.length})</h2>

      <input
        type="text"
        placeholder="Поиск по названию..."
        value={search}
        onChange={(event) => setSearch(event.target.value)}
      />

      <button onClick={() => setShowFavorites(false)}>
        Все звуки
      </button>

      <button onClick={() => setShowFavorites(true)}>
        ⭐ Избранное
      </button>

      <div>
        <label htmlFor="sound-sort">Сортировка: </label>

        <select
          id="sound-sort"
          value={sortBy}
          onChange={(event) => setSortBy(event.target.value)}
        >
          <option value="newest">Сначала новые</option>
          <option value="name">По названию: А — Я</option>
          <option value="size">По размеру: большие сначала</option>
        </select>
      </div>

      {loading ? (
        <p>Загрузка библиотеки...</p>
      ) : filteredSounds.length === 0 ? (
        <p>
          {showFavorites
            ? 'В избранном пока пусто.'
            : 'Звуки не найдены.'}
        </p>
      ) : (
        filteredSounds.map((sound) => (
          <div key={sound.id}>
            <h3>{sound.name}</h3>
            <p>{sound.size}</p>

            <button onClick={() => toggleFavorite(sound.id)}>
              {sound.favorite ? '⭐ В избранном' : '☆ В избранное'}
            </button>

            <audio controls src={sound.url} />

            <button onClick={() => removeSound(sound.id)}>
              Удалить
            </button>
          </div>
        ))
      )}
    </div>
  )
}
