import { Nav } from '@/components/nav'
import WorkKanbanApp from '@/components/work-kanban-app'

export default function Page() {
  return (
    <div className="flex flex-col h-screen">
      <Nav />
      <div className="flex-1 overflow-hidden">
        <WorkKanbanApp />
      </div>
    </div>
  )
}
