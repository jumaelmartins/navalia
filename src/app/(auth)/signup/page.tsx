'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { signUpBarbershop } from '@/modules/tenancy/signup-action'
import { BRAND } from '@/lib/brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'

export default function SignupPage() {
  const router = useRouter()
  const [form, setForm] = useState({
    name: '',
    email: '',
    password: '',
    shopName: '',
  })
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  function handleChange(e: React.ChangeEvent<HTMLInputElement>) {
    setForm((prev) => ({ ...prev, [e.target.name]: e.target.value }))
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const result = await signUpBarbershop(form)

      if (!result.ok) {
        setError(result.error)
        return
      }

      // Account created — now sign in to obtain the session cookie
      await authClient.signIn.email(
        {
          email: form.email,
          password: form.password,
          callbackURL: '/dashboard/onboarding',
        },
        {
          onSuccess: () => {
            router.push('/dashboard/onboarding')
          },
          onError: () => {
            // Account exists — redirect to login so they can sign in manually
            router.push('/login')
          },
        },
      )
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col items-center gap-6">
      <Link href="/" className="font-display text-2xl font-semibold text-primary">
        {BRAND.name}
      </Link>
      <Card className="w-full max-w-sm shadow-md">
      <CardHeader className="pb-2">
        <CardTitle className="text-2xl font-semibold font-display">Criar conta</CardTitle>
        <CardDescription>Comece seu período de avaliação gratuito de 7 dias</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="name">Seu nome</Label>
            <Input
              id="name"
              name="name"
              type="text"
              autoComplete="name"
              required
              placeholder="João Silva"
              value={form.name}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              required
              placeholder="voce@exemplo.com"
              value={form.email}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              name="password"
              type="password"
              autoComplete="new-password"
              required
              placeholder="Mínimo 8 caracteres"
              value={form.password}
              onChange={handleChange}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="shopName">Nome da barbearia</Label>
            <Input
              id="shopName"
              name="shopName"
              type="text"
              required
              placeholder="Barbearia do João"
              value={form.shopName}
              onChange={handleChange}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full hover:bg-primary-hover"
            disabled={loading}
          >
            {loading ? 'Criando conta…' : 'Criar conta'}
          </Button>
        </form>

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Já tem uma conta?{' '}
          <Link href="/login" className="text-primary underline-offset-4 hover:underline">
            Entrar
          </Link>
        </p>
      </CardContent>
    </Card>
    </div>
  )
}
