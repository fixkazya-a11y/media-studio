import { useParams, useNavigate } from 'react-router-dom'

export default function ProjectEditor() {
  const { id } = useParams()
  const navigate = useNavigate()

  return (
    <div>
      <button type="button" onClick={() => navigate('/')}>
        ← Назад к проектам
      </button>

      <h1>Редактор проекта</h1>

      <p>ID проекта: {id}</p>

      <p>Здесь будет находиться рабочее пространство проекта.</p>
    </div>
  )
}