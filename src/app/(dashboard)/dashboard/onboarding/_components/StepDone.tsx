'use client'

import { useState } from 'react'
import Link from 'next/link'
import { CheckCircle, Copy, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'

interface Props {
  slug: string
}

export function StepDone({ slug }: Props) {
  const appUrl =
    process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000'
  const publicUrl = `${appUrl}/${slug}`

  const [copied, setCopied] = useState(false)

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(publicUrl)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // fallback: select the text — ignore
    }
  }

  return (
    <div className="flex flex-col items-center gap-6 py-4 text-center">
      <div className="flex size-16 items-center justify-center rounded-full bg-primary/10">
        <CheckCircle className="size-8 text-primary" />
      </div>

      <div className="space-y-1">
        <h2 className="font-display text-2xl font-semibold text-foreground">
          Barbearia configurada!
        </h2>
        <p className="text-sm text-muted-foreground">
          Seu espaço está pronto para receber agendamentos.
        </p>
      </div>

      <div className="w-full space-y-2">
        <p className="text-sm font-medium text-foreground">Sua página pública</p>
        <div className="flex items-center gap-2 rounded-lg border border-border bg-muted px-3 py-2">
          <span className="flex-1 truncate text-left text-sm text-muted-foreground">
            {publicUrl}
          </span>
          <button
            type="button"
            onClick={handleCopy}
            className="shrink-0 text-muted-foreground transition-colors hover:text-foreground"
            aria-label="Copiar link"
          >
            {copied ? (
              <Check className="size-4 text-primary" />
            ) : (
              <Copy className="size-4" />
            )}
          </button>
        </div>
        {copied && (
          <p className="text-xs text-primary">Link copiado!</p>
        )}
      </div>

      <Link
        href="/dashboard"
        className="inline-flex w-full items-center justify-center rounded-lg bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary-hover focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/50"
      >
        Ir para o painel
      </Link>
    </div>
  )
}
