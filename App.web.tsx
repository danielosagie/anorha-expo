/**
 * App.web.tsx — web-only entry (Metro resolves this over App.tsx for web).
 *
 * Design-export router for Figma import:
 *   - http://localhost:8082/                 → index of flows + screens
 *   - http://localhost:8082/?flow=<slug>     → ONE master page with every screen of that flow (import all at once)
 *   - http://localhost:8082/?screen=<key>    → a single real screen
 *
 * The native app can't run on web (Clerk/secure-store/etc.), so the web build is
 * purely this export tool. Native-only deps are mocked at the Metro level (metro.config.js).
 */
import React, { Suspense } from 'react';
import './src/screens/designExport/webFetchMock';
import { ROUTES, ROUTES_BY_KEY, GROUPS, FLOWS, SLUG_TO_GROUP } from './src/screens/designExport/registry';

const Harness = React.lazy(() => import('./src/screens/designExport/Harness'));
const FlowPage = React.lazy(() => import('./src/screens/designExport/FlowPage'));

function getParam(name: string): string | null {
  if (typeof window === 'undefined') return null;
  return new URLSearchParams(window.location.search).get(name);
}

const SLUG_BY_GROUP: Record<string, string> = Object.fromEntries(FLOWS.map((f) => [f.group, f.slug]));

// Web-only index page (real DOM anchors so each opens in its own tab).
function IndexPage() {
  return React.createElement(
    'div',
    { style: { fontFamily: 'system-ui, sans-serif', background: '#EEF1F4', minHeight: '100vh', padding: '40px 24px', boxSizing: 'border-box' } },
    React.createElement('h1', { style: { margin: 0, fontSize: 28, color: '#111827' } }, 'sssync — Design Export'),
    React.createElement('p', { style: { marginTop: 6, marginBottom: 28, color: '#6B7280', fontSize: 15 } },
      'Open a whole flow as one master page (import all its screens at once), or open a single screen.'),
    ...GROUPS.map((group) => {
      const slug = SLUG_BY_GROUP[group];
      return React.createElement(
        'div',
        { key: group, style: { marginBottom: 28 } },
        React.createElement(
          'div',
          { style: { display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 12 } },
          React.createElement('h2', { style: { fontSize: 14, textTransform: 'uppercase', letterSpacing: 1, color: '#374151', margin: 0 } }, group),
          slug && React.createElement(
            'a',
            { href: `?flow=${slug}`, target: '_blank', rel: 'noreferrer',
              style: { fontSize: 13, fontWeight: 700, color: '#3CAD46', textDecoration: 'none' } },
            'Open entire flow →'
          )
        ),
        React.createElement(
          'div',
          { style: { display: 'flex', flexWrap: 'wrap', gap: 10 } },
          ...ROUTES.filter((r) => r.group === group).map((r) =>
            React.createElement(
              'a',
              {
                key: r.key,
                href: `?screen=${r.key}`,
                target: '_blank',
                rel: 'noreferrer',
                style: {
                  display: 'block', background: '#fff', border: '1px solid #E5E7EB', borderRadius: 12,
                  padding: '10px 14px', textDecoration: 'none', color: '#111827', fontSize: 13, fontWeight: 600,
                  minWidth: 160, boxShadow: '0 1px 2px rgba(0,0,0,0.04)',
                },
              },
              r.title,
              React.createElement('div', { style: { fontSize: 11, color: '#9CA3AF', fontWeight: 400, marginTop: 2 } }, `?screen=${r.key}`)
            )
          )
        )
      );
    })
  );
}

export default function App() {
  const flowSlug = getParam('flow');
  const screenKey = getParam('screen');

  if (flowSlug && SLUG_TO_GROUP[flowSlug]) {
    return (
      <Suspense fallback={null}>
        <FlowPage group={SLUG_TO_GROUP[flowSlug]} />
      </Suspense>
    );
  }

  const route = screenKey ? ROUTES_BY_KEY[screenKey] : null;
  if (route) {
    return (
      <Suspense fallback={null}>
        <Harness route={route} />
      </Suspense>
    );
  }
  return <IndexPage />;
}
