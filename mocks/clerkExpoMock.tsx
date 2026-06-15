/**
 * Web-only mock for @clerk/clerk-expo (and @clerk/clerk-expo/token-cache).
 * Metro aliases both to this file when platform === 'web' (see metro.config.js).
 *
 * The real Clerk hooks throw without a ClerkProvider and pull in native-only
 * deps that crash the web bundle. For the design-export web build we don't need
 * real auth — these stubs report a signed-in demo user so screens render.
 */
import React from 'react';

const MOCK_USER = {
  id: 'user_mock',
  firstName: 'Demo',
  lastName: 'Seller',
  fullName: 'Demo Seller',
  username: 'demoseller',
  primaryEmailAddress: { emailAddress: 'demo@sssync.app' },
  emailAddresses: [{ id: 'email_mock', emailAddress: 'demo@sssync.app' }],
  primaryPhoneNumber: { phoneNumber: '+15555550123' },
  imageUrl: '',
  createPhoneNumber: async () => ({}),
  update: async () => ({}),
};

const completeResult = { status: 'complete', createdSessionId: 'sess_mock' };

export const ClerkProvider = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const ClerkLoaded = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const ClerkLoading = () => null;
export const SignedIn = ({ children }: { children?: React.ReactNode }) => <>{children}</>;
export const SignedOut = () => null;
export const Protect = ({ children }: { children?: React.ReactNode }) => <>{children}</>;

export const useAuth = () => ({
  isLoaded: true,
  isSignedIn: true,
  userId: MOCK_USER.id,
  sessionId: 'sess_mock',
  orgId: 'org_mock',
  getToken: async () => 'mock_jwt_token',
  signOut: async () => {},
});

export const useUser = () => ({ isLoaded: true, isSignedIn: true, user: MOCK_USER });

export const useClerk = () => ({
  signOut: async () => {},
  openSignIn: () => {},
  setActive: async () => {},
  user: MOCK_USER,
});

export const useSignIn = () => ({
  isLoaded: true,
  setActive: async () => {},
  signIn: {
    create: async () => completeResult,
    attemptFirstFactor: async () => completeResult,
    prepareFirstFactor: async () => ({}),
    status: 'needs_first_factor',
  },
});

export const useSignUp = () => ({
  isLoaded: true,
  setActive: async () => {},
  signUp: {
    create: async () => completeResult,
    prepareEmailAddressVerification: async () => ({}),
    attemptEmailAddressVerification: async () => completeResult,
    preparePhoneNumberVerification: async () => ({}),
    attemptPhoneNumberVerification: async () => completeResult,
    status: 'missing_requirements',
  },
});

export const useSSO = () => ({
  startSSOFlow: async () => ({ createdSessionId: 'sess_mock', setActive: async () => {} }),
});

export const useOrganizationList = () => ({
  isLoaded: true,
  userInvitations: { data: [], hasNextPage: false, isLoading: false, fetchNext: async () => {} },
  userMemberships: { data: [], hasNextPage: false, isLoading: false, fetchNext: async () => {} },
  setActive: async () => {},
  createOrganization: async () => ({
    id: 'org_mock',
    name: 'Demo Business',
    inviteMember: async () => ({ success: true }),
  }),
});

export const useOrganization = () => ({
  isLoaded: true,
  organization: { id: 'org_mock', name: 'Demo Business' },
  membership: { role: 'org:admin' },
});

// @clerk/clerk-expo/token-cache
export const tokenCache = {
  getToken: async () => null,
  saveToken: async () => {},
  clearToken: async () => {},
};

export default { ClerkProvider, useAuth, useUser, useSignIn, useSignUp, useSSO, useOrganizationList, SignedIn, SignedOut, tokenCache };
