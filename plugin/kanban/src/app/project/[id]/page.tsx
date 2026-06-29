import { Nav } from '@/components/nav'
import ProjectDetailApp from '@/components/project-detail-app'

export default function Page() {
  return (
    <div className="flex flex-col h-screen">
      <Nav />
      <div className="flex-1 overflow-hidden">
        <ProjectDetailApp />
      </div>
    </div>
  )
}
