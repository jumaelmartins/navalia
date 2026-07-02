import type { Metadata } from 'next'
import { BRAND } from '@/lib/brand'
import { formatCentsToBRL } from '@/modules/tenancy/money'
import { Nav } from './_components/Nav'
import { Hero } from './_components/Hero'
import { SocialProof } from './_components/SocialProof'
import { Features } from './_components/Features'
import { HowItWorks } from './_components/HowItWorks'
import { Pricing } from './_components/Pricing'
import { FAQ } from './_components/FAQ'
import { Footer } from './_components/Footer'

export const metadata: Metadata = {
  title: `${BRAND.name} — ${BRAND.tagline}`,
  description: `${BRAND.name}: agenda inteligente, chatbot WhatsApp com IA e copiloto de insights para barbearias brasileiras. Teste grátis por 7 dias, sem cartão de crédito.`,
}

function formatPrice(cents: number): string {
  const formatted = formatCentsToBRL(cents)
  // Strip trailing ,00 for whole-reais prices (e.g. "R$ 99,00" → "R$ 99")
  return formatted.endsWith(',00') ? formatted.slice(0, -3) : formatted
}

export default function MarketingPage() {
  const priceCents = parseInt(process.env.PLAN_PRICE_CENTS ?? '9900', 10)
  const priceDisplay = formatPrice(priceCents)

  return (
    <>
      <Nav />
      <main>
        <Hero />
        <SocialProof />
        <Features />
        <HowItWorks />
        <Pricing priceDisplay={priceDisplay} />
        <FAQ />
      </main>
      <Footer />
    </>
  )
}
