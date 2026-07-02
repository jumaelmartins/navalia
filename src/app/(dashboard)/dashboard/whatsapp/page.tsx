import { requireOnboarded } from '@/modules/tenancy/context'
import { getHumanConversations } from '@/modules/whatsapp/conversation-actions'
import { WhatsAppClient } from './_components/WhatsAppClient'
import { HumanConversationsList } from './_components/HumanConversationsList'

export default async function WhatsAppPage() {
  const { barbershop } = await requireOnboarded()

  // I9: Fetch TRANSFERRED_TO_HUMAN conversations so operators can reopen them.
  let humanConversations: Awaited<ReturnType<typeof getHumanConversations>> = []
  try {
    humanConversations = await getHumanConversations()
  } catch {
    // Non-fatal — page still renders without the list
  }

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

      <HumanConversationsList initialConversations={humanConversations} />
    </main>
  )
}
