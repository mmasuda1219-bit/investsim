import { Metadata } from 'next'
import { AISessionClient } from './client'

export const metadata: Metadata = { title: 'AI自動売買 — InvestSim' }

export default function AISessionPage() {
  return <AISessionClient />
}
