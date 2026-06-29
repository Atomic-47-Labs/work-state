import { Nav } from '@/components/nav'
import ClaudashApp from '@/components/claudash-app'

export default function ClaudashPage() {
  return (
    <div className="flex flex-col min-h-screen" style={{ background: '#f5f0e8' }}>
      <Nav />
      <ClaudashApp />
    </div>
  )
}
