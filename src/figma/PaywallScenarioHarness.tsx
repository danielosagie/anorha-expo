import React, { useMemo } from 'react'
import { SafeAreaView } from 'react-native'

import Paywall from '../components/Paywall'
import { ThemeProvider } from '../context/ThemeContext'

import type { UserEntitlements } from '../utils/entitlements'

type ScenarioPayload = {
  props?: {
    visible?: boolean
    feature?: string
    entitlements?: UserEntitlements | null
  }
}

function getScenarioPayload(): ScenarioPayload {
  const g = globalThis as unknown as Record<string, unknown>
  const raw = g.__FIGMA_USE_SCENARIO__
  if (!raw || typeof raw !== 'object') return {}
  return raw as ScenarioPayload
}

function markReady() {
  const g = globalThis as unknown as Record<string, unknown>
  const mark = g.__FIGMA_USE_MARK_READY__
  if (typeof mark === 'function') {
    ;(mark as () => void)()
  } else {
    g.__FIGMA_USE_READY__ = true
  }
}

export default function PaywallScenarioHarness() {
  const payload = getScenarioPayload()
  const props = payload.props ?? {}

  const entitlements = useMemo<UserEntitlements | null>(
    () => props.entitlements ?? null,
    [props.entitlements]
  )

  // Defer a tick so layout + fonts/images settle before readiness.
  React.useEffect(() => {
    const id = setTimeout(() => markReady(), 250)
    return () => clearTimeout(id)
  }, [])

  return (
    <ThemeProvider>
      <SafeAreaView style={{ flex: 1, backgroundColor: 'transparent' }}>
        <Paywall
          visible={props.visible ?? true}
          onClose={() => {}}
          onUpgrade={() => {}}
          entitlements={entitlements}
          feature={props.feature}
        />
      </SafeAreaView>
    </ThemeProvider>
  )
}

