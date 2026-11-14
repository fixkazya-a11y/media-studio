
import { telegram } from '../telegram/telegram'

export type Project = {
  id: string
  telegram_user_id: number
  name: string
  project_type: string
  data: Record<string, unknown>
  created_at: string
  updated_at: string
}

type ApiResponse<T> = {
  success?: boolean
  error?: string
  details?: unknown
} & T

const LOCAL_STORAGE_KEY = 'media-studio-local-projects'

const isLocalMode = import.meta.env.DEV && !telegram?.initData

function getLocalProjects(): Project[] {
  try {
    const saved = localStorage.getItem(LOCAL_STORAGE_KEY)
    return saved ? JSON.parse(saved) as Project[] : []
  } catch {
    return []
  }
}

function saveLocalProjects(projects: Project[]) {
  localStorage.setItem(
    LOCAL_STORAGE_KEY,
    JSON.stringify(projects),
  )
}

async function request<T>(
  body: Record<string, unknown>,
): Promise<T> {
  if (!telegram?.initData) {
    throw new Error('Открой Media Studio через Telegram')
  }

  const response = await fetch('/api/projects', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      ...body,
      initData: telegram.initData,
    }),
  })

  const result = (await response.json()) as ApiResponse<T>

  console.log('PROJECT API RESPONSE:', response.status, result)

  if (!response.ok || !result.success) {
    const details = result.details
      ? JSON.stringify(result.details)
      : ''

    throw new Error(
      [result.error || 'Ошибка сервера', details]
        .filter(Boolean)
        .join(': '),
    )
  }

  return result
}

export async function getProjects(): Promise<Project[]> {
  if (isLocalMode) {
    return getLocalProjects().sort(
      (a, b) =>
        new Date(b.updated_at).getTime() -
        new Date(a.updated_at).getTime(),
    )
  }

  const result = await request<{ projects: Project[] }>({
    action: 'list',
  })

  return result.projects
}

export async function getProject(id: string): Promise<Project> {
  if (isLocalMode) {
    const project = getLocalProjects().find(
      (item) => item.id === id,
    )

    if (!project) {
      throw new Error('Проект не найден')
    }

    return project
  }

  const result = await request<{ project: Project }>({
    action: 'get',
    id,
  })

  return result.project
}

export async function createProject(
  name: string,
  projectType = 'karaoke',
): Promise<Project> {
  if (isLocalMode) {
    const now = new Date().toISOString()

    const project: Project = {
      id: `local-${crypto.randomUUID()}`,
      telegram_user_id: 999999999,
      name: name.trim() || 'Новый проект',
      project_type: projectType,
      data: {},
      created_at: now,
      updated_at: now,
    }

    saveLocalProjects([
      project,
      ...getLocalProjects(),
    ])

    return project
  }

  const result = await request<{ project: Project }>({
    action: 'create',
    name,
    project_type: projectType,
    data: {},
  })

  return result.project
}

export async function updateProject(
  id: string,
  updates: {
    name?: string
    data?: Record<string, unknown>
  },
): Promise<Project> {
  if (isLocalMode) {
    const projects = getLocalProjects()
    const index = projects.findIndex(
      (item) => item.id === id,
    )

    if (index === -1) {
      throw new Error('Проект не найден')
    }

    const project = {
      ...projects[index],
      ...updates,
      updated_at: new Date().toISOString(),
    }

    projects[index] = project
    saveLocalProjects(projects)

    return project
  }

  const result = await request<{ project: Project }>({
    action: 'update',
    id,
    ...updates,
  })

  return result.project
}

export async function updateProjectData(
  id: string,
  dataPatch: Record<string, unknown>,
): Promise<Project> {
  if (isLocalMode) {
    const projects = getLocalProjects()
    const index = projects.findIndex(
      (item) => item.id === id,
    )

    if (index === -1) {
      throw new Error('Проект не найден')
    }

    const project = {
      ...projects[index],
      data: {
        ...projects[index].data,
        ...dataPatch,
      },
      updated_at: new Date().toISOString(),
    }

    projects[index] = project
    saveLocalProjects(projects)

    return project
  }

  const result = await request<{ project: Project }>({
    action: 'update',
    id,
    dataPatch,
  })

  return result.project
}

export async function deleteProject(id: string): Promise<void> {
  if (isLocalMode) {
    saveLocalProjects(
      getLocalProjects().filter(
        (project) => project.id !== id,
      ),
    )

    return
  }

  await request<{ message: string }>({
    action: 'delete',
    id,
  })
}
