import { requireOnboarded } from '@/modules/tenancy/context'

export default async function DashboardPage() {
  const { barbershop } = await requireOnboarded()

  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-8">
      <h1 className="text-3xl font-semibold">{barbershop.name}</h1>
      <p className="text-muted-foreground">Painel em construção</p>
    </main>
  )
}
