import { Nav } from '@/components/nav'
import InventoryApp from '@/components/inventory-app'

export default function Page() {
  return (
    <div className="flex flex-col h-screen">
      <Nav />
      <div className="flex-1 overflow-hidden">
        <InventoryApp />
      </div>
    </div>
  )
}
