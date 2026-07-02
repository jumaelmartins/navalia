'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { toast } from 'sonner'
import { MessageSquareIcon, QrCodeIcon, CheckCircle2Icon, XCircleIcon, RefreshCwIcon, WifiOffIcon } from 'lucide-react'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  connectWhatsApp,
  refreshWhatsAppStatus,
  disconnectWhatsApp,
  resetWhatsApp,
} from '@/modules/whatsapp/instance-actions'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

type WhatsappStatus = 'DISCONNECTED' | 'CONNECTING' | 'CONNECTED'

// ---------------------------------------------------------------------------
// Status badge
// ---------------------------------------------------------------------------

const STATUS_CONFIG: Record<
  WhatsappStatus,
  { label: string; className: string; icon: React.ComponentType<{ className?: string }> }
> = {
  DISCONNECTED: {
    label: 'Desconectado',
    className: 'bg-[var(--status-cancelled)] text-[var(--status-cancelled-fg)]',
    icon: WifiOffIcon,
  },
  CONNECTING: {
    label: 'Conectando…',
    className: 'bg-[var(--status-pending)] text-[var(--status-pending-fg)]',
    icon: RefreshCwIcon,
  },
  CONNECTED: {
    label: 'Conectado',
    className: 'bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]',
    icon: CheckCircle2Icon,
  },
}

function StatusBadge({ status }: { status: WhatsappStatus }) {
  const cfg = STATUS_CONFIG[status]
  const Icon = cfg.icon
  return (
    <Badge className={`${cfg.className} flex items-center gap-1.5 px-3 py-1 text-sm font-medium`}>
      <Icon className="size-3.5" />
      {cfg.label}
    </Badge>
  )
}

// ---------------------------------------------------------------------------
// Confirm dialog (simple native; no external dep)
// ---------------------------------------------------------------------------

function useConfirm() {
  return (message: string) => window.confirm(message)
}

// ---------------------------------------------------------------------------
// Main client component
// ---------------------------------------------------------------------------

const QR_POLL_INTERVAL_MS = 3000
const QR_TIMEOUT_MS = 90_000 // 90 seconds before "QR expired"

export function WhatsAppClient({
  initialStatus,
  instanceId,
}: {
  initialStatus: WhatsappStatus
  instanceId: string | null
}) {
  const confirm = useConfirm()

  const [status, setStatus] = useState<WhatsappStatus>(initialStatus)
  const [qrBase64, setQrBase64] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [qrExpired, setQrExpired] = useState(false)

  // Polling refs
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const qrTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const stopPolling = useCallback(() => {
    if (pollRef.current) clearInterval(pollRef.current)
    if (qrTimeoutRef.current) clearTimeout(qrTimeoutRef.current)
    pollRef.current = null
    qrTimeoutRef.current = null
  }, [])

  // Start polling when connecting
  const startPolling = useCallback(() => {
    stopPolling()
    setQrExpired(false)

    // Timeout after 90s
    qrTimeoutRef.current = setTimeout(() => {
      stopPolling()
      setQrExpired(true)
    }, QR_TIMEOUT_MS)

    pollRef.current = setInterval(async () => {
      const res = await refreshWhatsAppStatus()
      if (!res.ok) return

      setStatus(res.data!.status)
      if (res.data!.qrBase64) setQrBase64(res.data!.qrBase64)

      if (res.data!.status === 'CONNECTED') {
        stopPolling()
        setQrBase64(null)
      } else if (res.data!.status === 'DISCONNECTED') {
        stopPolling()
        setQrBase64(null)
      }
    }, QR_POLL_INTERVAL_MS)
  }, [stopPolling])

  // Auto-start polling if page loaded in CONNECTING state
  useEffect(() => {
    if (status === 'CONNECTING' && instanceId) {
      startPolling()
    }
    return stopPolling
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------

  async function handleConnect() {
    setLoading(true)
    setQrExpired(false)
    try {
      const res = await connectWhatsApp()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      setStatus('CONNECTING')
      if (res.data?.qrBase64) setQrBase64(res.data.qrBase64)
      startPolling()
    } finally {
      setLoading(false)
    }
  }

  async function handleDisconnect() {
    if (!confirm('Deseja desconectar o WhatsApp? A barbearia deixará de receber mensagens.')) return
    setLoading(true)
    try {
      const res = await disconnectWhatsApp()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      stopPolling()
      setStatus('DISCONNECTED')
      setQrBase64(null)
      toast.success('WhatsApp desconectado.')
    } finally {
      setLoading(false)
    }
  }

  async function handleReset() {
    if (!confirm('Isso apagará a instância inteira e você precisará escanear o QR novamente. Continuar?')) return
    setLoading(true)
    try {
      const res = await resetWhatsApp()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      stopPolling()
      setStatus('DISCONNECTED')
      setQrBase64(null)
      toast.success('Instância WhatsApp removida. Conecte novamente quando quiser.')
    } finally {
      setLoading(false)
    }
  }

  async function handleRegenerateQr() {
    setQrExpired(false)
    setLoading(true)
    try {
      const res = await connectWhatsApp()
      if (!res.ok) {
        toast.error(res.error)
        return
      }
      if (res.data?.qrBase64) setQrBase64(res.data.qrBase64)
      startPolling()
    } finally {
      setLoading(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="space-y-6">
      {/* Status card */}
      <Card className="shadow-sm">
        <CardHeader>
          <div className="flex items-center justify-between gap-4 flex-wrap">
            <div className="flex items-center gap-2">
              <MessageSquareIcon className="size-5 text-muted-foreground" />
              <CardTitle className="text-base">Status da conexão</CardTitle>
            </div>
            <StatusBadge status={status} />
          </div>
          <CardDescription>
            {status === 'CONNECTED' &&
              'Seu número está conectado. A barbearia pode receber e enviar mensagens via WhatsApp.'}
            {status === 'CONNECTING' &&
              'Escaneie o QR code abaixo com o WhatsApp do número da barbearia.'}
            {status === 'DISCONNECTED' &&
              'Conecte o número da barbearia para ativar o atendimento via WhatsApp.'}
          </CardDescription>
        </CardHeader>

        <CardContent className="space-y-6">
          {/* ── DISCONNECTED ──────────────────────────────────────────── */}
          {status === 'DISCONNECTED' && (
            <div className="space-y-4">
              <div className="rounded-lg border border-border bg-muted/30 p-4 space-y-2 text-sm text-muted-foreground">
                <p className="font-medium text-foreground">Como funciona:</p>
                <ul className="list-disc pl-5 space-y-1">
                  <li>Conecte o <strong>número da barbearia</strong> (não o seu pessoal).</li>
                  <li>O cliente escaneia o QR code uma única vez.</li>
                  <li>Após conectado, mensagens chegam automaticamente.</li>
                </ul>
                <p className="mt-2 text-xs text-amber-600 dark:text-amber-400 font-medium">
                  Aviso: esta integração usa a API não-oficial do WhatsApp. Evite envio
                  em massa para proteger o número da barbearia.
                </p>
              </div>

              <Button onClick={handleConnect} disabled={loading} className="w-full sm:w-auto">
                <QrCodeIcon className="mr-2 size-4" />
                {loading ? 'Aguarde…' : 'Conectar WhatsApp'}
              </Button>
            </div>
          )}

          {/* ── CONNECTING (QR) ───────────────────────────────────────── */}
          {status === 'CONNECTING' && (
            <div className="space-y-4">
              {qrExpired ? (
                <div className="flex flex-col items-center gap-4 py-8">
                  <XCircleIcon className="size-10 text-destructive" />
                  <p className="text-sm text-muted-foreground text-center">
                    O QR code expirou. Gere um novo para tentar novamente.
                  </p>
                  <Button onClick={handleRegenerateQr} disabled={loading} variant="outline">
                    <RefreshCwIcon className="mr-2 size-4" />
                    {loading ? 'Gerando…' : 'Gerar novo QR'}
                  </Button>
                </div>
              ) : qrBase64 ? (
                <div className="flex flex-col items-center gap-4">
                  <p className="text-sm text-muted-foreground text-center max-w-xs">
                    Abra o WhatsApp no celular da barbearia, toque em{' '}
                    <strong>Dispositivos vinculados</strong> e escaneie o código abaixo.
                  </p>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img
                    src={qrBase64}
                    alt="QR Code WhatsApp"
                    className="size-56 rounded-lg border border-border shadow-sm"
                  />
                  <p className="text-xs text-muted-foreground flex items-center gap-1.5">
                    <RefreshCwIcon className="size-3 animate-spin" />
                    Atualizando status automaticamente…
                  </p>
                </div>
              ) : (
                <div className="flex flex-col items-center gap-4 py-8">
                  <RefreshCwIcon className="size-8 text-muted-foreground animate-spin" />
                  <p className="text-sm text-muted-foreground text-center">
                    Gerando QR code… aguarde alguns segundos.
                  </p>
                </div>
              )}

              <div className="pt-2 border-t border-border">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleReset}
                  disabled={loading}
                  className="text-destructive hover:text-destructive"
                >
                  Cancelar e reiniciar
                </Button>
              </div>
            </div>
          )}

          {/* ── CONNECTED ──────────────────────────────────────────────── */}
          {status === 'CONNECTED' && (
            <div className="space-y-4">
              <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/30 p-4">
                <CheckCircle2Icon className="size-8 text-green-500 shrink-0" />
                <div>
                  <p className="text-sm font-medium text-foreground">WhatsApp conectado com sucesso!</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    A barbearia já pode receber e enviar mensagens automáticas.
                  </p>
                </div>
              </div>

              <div className="flex flex-wrap gap-3">
                <Button
                  variant="outline"
                  onClick={handleDisconnect}
                  disabled={loading}
                >
                  <WifiOffIcon className="mr-2 size-4" />
                  {loading ? 'Aguarde…' : 'Desconectar'}
                </Button>

                <Button
                  variant="ghost"
                  onClick={handleReset}
                  disabled={loading}
                  className="text-destructive hover:text-destructive"
                >
                  <RefreshCwIcon className="mr-2 size-4" />
                  Reconectar do zero
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Explainer card */}
      <Card className="shadow-sm border-dashed">
        <CardContent className="pt-6">
          <div className="flex gap-3">
            <MessageSquareIcon className="size-5 text-muted-foreground shrink-0 mt-0.5" />
            <div className="space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">Sobre a integração</p>
              <p>
                A Navalia conecta o número da barbearia ao WhatsApp para enviar
                confirmações de agendamento e receber mensagens dos clientes.
              </p>
              <p>
                O cliente escaneia o QR code uma única vez — depois disso, a conexão
                se mantém automaticamente.
              </p>
              <p className="text-xs text-amber-600 dark:text-amber-400 font-medium pt-1">
                Esta integração usa o protocolo não-oficial do WhatsApp. Para manter
                o número seguro, evite envios em massa e use apenas para atendimento
                de clientes reais.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  )
}
