import { requireOnboarded } from '@/modules/tenancy/context'
import { WhatsAppClient } from './_components/WhatsAppClient'

export default async function WhatsAppPage() {
  const { barbershop } = await requireOnboarded()

  return (
    <main className="p-6 space-y-6 max-w-2xl">
      <div>
        <h1 className="text-2xl font-semibold">WhatsApp</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Conecte o número da barbearia para receber agendamentos via WhatsApp.
        </p>
      </div>

      <WhatsAppClient
        initialStatus={barbershop.whatsappStatus}
        instanceId={barbershop.evolutionInstanceId}
      />
    </main>
  )
}
