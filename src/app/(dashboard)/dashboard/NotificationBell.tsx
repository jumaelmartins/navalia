'use client'

import { useEffect, useState, useCallback, useRef } from 'react'
import { BellIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

type NotificationItem = {
  id: string
  customerName: string | null
  serviceName: string | null
  startTime: string | null
  date: string | null
  readAt: string | null
  createdAt: string
}

export function NotificationBell() {
  const [unread, setUnread] = useState(0)
  const [items, setItems] = useState<NotificationItem[]>([])
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const load = useCallback(async () => {
    try {
      const r = await fetch('/api/notifications')
      if (!r.ok) return
      const data = await r.json()
      setUnread(data.unread)
      setItems(data.items)
    } catch {
      /* ignore transient network errors */
    }
  }, [])

  useEffect(() => {
    load()
    const id = setInterval(load, 30_000)
    return () => clearInterval(id)
  }, [load])

  // Close dropdown on outside click
  useEffect(() => {
    if (!open) return
    function handleOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false)
      }
    }
    document.addEventListener('mousedown', handleOutside)
    return () => document.removeEventListener('mousedown', handleOutside)
  }, [open])

  async function markAll() {
    await fetch('/api/notifications', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ all: true }),
    })
    load()
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-label="Notificações"
        onClick={() => setOpen((o) => !o)}
        className="relative flex items-center justify-center rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
      >
        <BellIcon className="size-4" />
        {unread > 0 && (
          <span className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-primary px-1 text-center text-[10px] leading-4 text-primary-foreground">
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      {open && (
        <div className="absolute right-0 z-30 mt-2 w-80 rounded-lg border border-border bg-card shadow-lg">
          <div className="flex items-center justify-between border-b border-border px-3 py-2">
            <span className="text-sm font-medium">Notificações</span>
            <button
              type="button"
              onClick={markAll}
              className="text-xs text-muted-foreground underline hover:text-foreground"
            >
              marcar tudo como lido
            </button>
          </div>
          <ul className="max-h-80 overflow-auto">
            {items.length === 0 && (
              <li className="px-3 py-4 text-sm text-muted-foreground">
                Nada por aqui.
              </li>
            )}
            {items.map((n) => (
              <li
                key={n.id}
                className={cn(
                  'border-b border-border/50 px-3 py-2.5 text-sm last:border-0',
                  n.readAt ? 'opacity-60' : 'bg-muted/40',
                )}
              >
                <div className="font-medium">Novo agendamento</div>
                <div className="mt-0.5 text-muted-foreground">
                  {n.customerName ?? 'Cliente'} — {n.serviceName ?? 'serviço'}
                  {n.date ? ` · ${n.date}` : ''}
                  {n.startTime ? ` ${n.startTime}` : ''}
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}
