'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'

export function Nav() {
  const path = usePathname()

  return (
    <nav
      className="h-10 flex items-center justify-between px-4 border-b border-stone-300 shrink-0"
      style={{ background: '#e4ddd2' }}
    >
      <span className="text-xs font-bold text-stone-600 tracking-wide uppercase">
        Work-State
      </span>

      <div className="flex items-center gap-1">
        {[
          { href: '/',           label: 'Kanban' },
          { href: '/dashboard',  label: 'Dashboard' },
          { href: '/inventory',  label: 'Inventory' },
          { href: '/claudash',   label: 'Claudash' },
          { href: '/about',      label: 'About' },
        ].map(({ href, label }) => {
          const active = path === href
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'text-xs px-3 py-1  font-medium transition-colors',
                active
                  ? 'bg-amber-700 text-white'
                  : 'text-stone-500 hover:text-stone-800 hover:bg-stone-200/60'
              )}
            >
              {label}
            </Link>
          )
        })}
      </div>
    </nav>
  )
}
