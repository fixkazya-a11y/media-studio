
import { openDB } from 'idb'

const dbPromise = openDB('media-studio', 2, {
  upgrade(db) {
    if (!db.objectStoreNames.contains('sounds')) {
      db.createObjectStore('sounds', {
        keyPath: 'id',
      })
    }

    if (!db.objectStoreNames.contains('projectAudios')) {
      db.createObjectStore('projectAudios', {
        keyPath: 'projectId',
      })
    }
  },
})

export type StoredSound = {
  id: number
  name: string
  size: string
  file: File
  favorite: boolean
}

export type StoredProjectAudio = {
  projectId: string
  name: string
  size: string
  type: string
  file: File
}

export async function saveSound(sound: StoredSound) {
  const db = await dbPromise
  await db.put('sounds', sound)
}

export async function getSounds(): Promise<StoredSound[]> {
  const db = await dbPromise
  return db.getAll('sounds')
}

export async function deleteStoredSound(id: number) {
  const db = await dbPromise
  await db.delete('sounds', id)
}

// Сохранение аудио в конкретный проект
export async function saveProjectAudio(audio: StoredProjectAudio) {
  const db = await dbPromise
  await db.put('projectAudios', audio)
}

// Получение аудио проекта
export async function getProjectAudio(
  projectId: string,
): Promise<StoredProjectAudio | undefined> {
  const db = await dbPromise
  return db.get('projectAudios', projectId)
}

// Удаление аудио проекта
export async function deleteProjectAudio(projectId: string) {
  const db = await dbPromise
  await db.delete('projectAudios', projectId)
}
