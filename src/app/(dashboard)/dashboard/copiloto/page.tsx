import { requireOnboarded } from '@/modules/tenancy/context'
import { CopilotClient } from './_components/CopilotClient'

export default async function CopilotoPage() {
  const { user } = await requireOnboarded()
  const role = user.role as 'OWNER' | 'BARBER'

  return (
    <main className="p-6 flex flex-col h-[calc(100vh-0px)]">
      <div className="mb-4">
        <h1 className="text-2xl font-semibold">Copiloto IA</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Consulte dados e opere a barbearia em linguagem natural.
        </p>
      </div>

      <div className="flex-1 min-h-0">
        <CopilotClient role={role} />
      </div>
    </main>
  )
}
