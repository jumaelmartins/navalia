'use client'

import { Suspense, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import Link from 'next/link'
import { authClient } from '@/lib/auth-client'
import { BRAND } from '@/lib/brand'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { GoogleSignInButton } from '@/components/auth/GoogleSignInButton'

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  )
}

function LoginForm() {
  const router = useRouter()
  const searchParams = useSearchParams()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState<string | null>(() =>
    searchParams.get('error') ? 'Não foi possível entrar com Google. Tente novamente.' : null,
  )
  const [loading, setLoading] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      await authClient.signIn.email(
        { email, password, callbackURL: '/dashboard' },
        {
          onSuccess: () => {
            router.push('/dashboard')
          },
          onError: (ctx) => {
            setError(
              ctx.error.status === 401
                ? 'E-mail ou senha incorretos.'
                : 'Não foi possível entrar. Tente novamente.',
            )
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
        <CardTitle className="text-2xl font-semibold font-display">Entrar</CardTitle>
        <CardDescription>Acesse o painel da sua barbearia</CardDescription>
      </CardHeader>

      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="email">E-mail</Label>
            <Input
              id="email"
              type="email"
              autoComplete="email"
              required
              placeholder="voce@exemplo.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="password">Senha</Label>
            <Input
              id="password"
              type="password"
              autoComplete="current-password"
              required
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>

          {error && <p className="text-xs text-destructive">{error}</p>}

          <Button
            type="submit"
            className="w-full hover:bg-primary-hover"
            disabled={loading}
          >
            {loading ? 'Entrando…' : 'Entrar'}
          </Button>
        </form>

        <div className="my-4 flex items-center gap-3">
          <div className="h-px flex-1 bg-border" />
          <span className="text-xs text-muted-foreground">ou</span>
          <div className="h-px flex-1 bg-border" />
        </div>

        <GoogleSignInButton errorCallbackURL="/login" />

        <p className="mt-4 text-center text-sm text-muted-foreground">
          Ainda não tem conta?{' '}
          <Link href="/signup" className="text-primary underline-offset-4 hover:underline">
            Criar conta
          </Link>
        </p>
      </CardContent>
    </Card>
    </div>
  )
}
