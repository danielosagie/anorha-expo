import { registerRootComponent } from 'expo';

const scenario = globalThis?.__FIGMA_USE_SCENARIO__;
const shouldUsePaywallHarness =
  scenario &&
  typeof scenario === 'object' &&
  ((typeof scenario.component === 'string' && scenario.component.toLowerCase() === 'paywall') ||
    (typeof scenario.name === 'string' && scenario.name.toLowerCase().includes('paywall')));

const AppComponent = shouldUsePaywallHarness
  ? require('./src/figma/PaywallScenarioHarness').default
  : require('./App').default;

registerRootComponent(AppComponent);
