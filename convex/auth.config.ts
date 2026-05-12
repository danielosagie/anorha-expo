import { AuthConfig } from 'convex/server';

export default {
  providers: [
    // Strict providers when aud is present.
    { domain: 'https://clerk.app.anorha.app', applicationID: 'mobile' },
    { domain: 'https://clerk.app.anorha.app', applicationID: 'convex' },
    { domain: 'https://clerk.app.anorha.app', applicationID: 'authenticated' },
    // Fallback provider for Clerk JWTs that omit aud in template claims.
    {
      type: 'customJwt',
      issuer: 'https://clerk.app.anorha.app',
      jwks: 'https://clerk.app.anorha.app/.well-known/jwks.json',
      algorithm: 'RS256',
    },
  ],
} satisfies AuthConfig;
