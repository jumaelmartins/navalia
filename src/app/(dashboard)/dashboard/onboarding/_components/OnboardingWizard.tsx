'use client'

import { useState } from 'react'
import { BRAND } from '@/lib/brand'
import { Card, CardContent, CardHeader } from '@/components/ui/card'
import { StepBasics } from './StepBasics'
import { StepHours } from './StepHours'
import { StepService } from './StepService'
import { StepProfessional } from './StepProfessional'
import { StepDone } from './StepDone'
import { cn } from '@/lib/utils'

// ---------------------------------------------------------------------------
// Step metadata
// ---------------------------------------------------------------------------

const STEPS = [
  { label: 'Sua barbearia', headline: 'Como se chama sua barbearia?' },
  { label: 'Horários', headline: 'Quando você atende?' },
  { label: 'Serviço', headline: 'Qual é o primeiro serviço?' },
  { label: 'Profissional', headline: 'Quem vai atender?' },
] as const

type StepIndex = 0 | 1 | 2 | 3

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface Props {
  barbershopName: string
  barbershopSlug: string
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function OnboardingWizard({ barbershopName, barbershopSlug }: Props) {
  const [step, setStep] = useState<StepIndex | 4>(0)

  function next() {
    setStep((s) => (s < 4 ? ((s + 1) as StepIndex | 4) : 4))
  }
  function back() {
    setStep((s) => (s > 0 ? ((s - 1) as StepIndex) : 0))
  }

  const isDone = step === 4

  return (
    <div className="flex min-h-screen flex-col items-center justify-center px-4 py-12">
      {/* Logo */}
      <p className="mb-8 font-display text-2xl font-semibold text-primary">
        {BRAND.name}
      </p>

      <Card className="w-full max-w-lg shadow-sm">
        {/* Progress indicator */}
        {!isDone && (
          <div className="px-6 pt-6">
            <ProgressBar current={step as StepIndex} total={STEPS.length} />
            <p className="mt-1 text-xs text-muted-foreground">
              Passo {(step as number) + 1} de {STEPS.length}
            </p>
          </div>
        )}

        <CardHeader className={isDone ? 'pt-6' : 'pt-4 pb-2'}>
          {!isDone && (
            <h1 className="font-display text-2xl font-semibold text-foreground">
              {STEPS[step as StepIndex].headline}
            </h1>
          )}
        </CardHeader>

        <CardContent className="pb-6">
          {step === 0 && (
            <StepBasics initialName={barbershopName} onNext={next} />
          )}
          {step === 1 && <StepHours onNext={next} onBack={back} />}
          {step === 2 && <StepService onNext={next} onBack={back} />}
          {step === 3 && <StepProfessional onNext={next} onBack={back} />}
          {step === 4 && <StepDone slug={barbershopSlug} />}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Progress bar sub-component
// ---------------------------------------------------------------------------

function ProgressBar({ current, total }: { current: StepIndex; total: number }) {
  return (
    <div className="flex gap-1.5">
      {Array.from({ length: total }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-1 flex-1 rounded-full transition-colors duration-300',
            i <= current ? 'bg-primary' : 'bg-muted',
          )}
        />
      ))}
    </div>
  )
}
