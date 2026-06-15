import * as SecureStore from 'expo-secure-store';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { createLogger } from './logger';
const log = createLogger('AuthPersistence');


interface AuthState {
  isAuthenticated: boolean;
  userId: string | null;
  email: string | null;
  lastAuthCheck: number;
  tokenExpiry: number;
}

const AUTH_STATE_KEY = 'sssync_auth_state';
const TOKEN_CACHE_KEY = 'sssync_token_cache';

export class AuthPersistence {
  private static instance: AuthPersistence;
  private authState: AuthState | null = null;
  
  static getInstance(): AuthPersistence {
    if (!AuthPersistence.instance) {
      AuthPersistence.instance = new AuthPersistence();
    }
    return AuthPersistence.instance;
  }

  // Store auth state in AsyncStorage for fast access
  async saveAuthState(state: Partial<AuthState>): Promise<void> {
    try {
      const currentState = await this.getAuthState() || {
        isAuthenticated: false,
        userId: null,
        email: null,
        lastAuthCheck: 0,
        tokenExpiry: 0,
      };
      
      const newState: AuthState = {
        ...currentState,
        ...state,
        lastAuthCheck: Date.now(),
      };
      
      await AsyncStorage.setItem(AUTH_STATE_KEY, JSON.stringify(newState));
      this.authState = newState;
      log.debug('[AuthPersistence] Auth state saved:', { 
        isAuthenticated: newState.isAuthenticated, 
        userId: newState.userId,
        email: newState.email
      });
    } catch (error) {
      log.error('[AuthPersistence] Failed to save auth state:', error);
    }
  }

  async getAuthState(): Promise<AuthState | null> {
    try {
      if (this.authState) return this.authState;
      
      const stored = await AsyncStorage.getItem(AUTH_STATE_KEY);
      if (!stored) return null;
      
      this.authState = JSON.parse(stored);
      return this.authState;
    } catch (error) {
      log.error('[AuthPersistence] Failed to get auth state:', error);
      return null;
    }
  }

  // Store sensitive tokens in SecureStore
  async saveTokens(clerkToken: string, supabaseToken: string): Promise<void> {
    try {
      const tokenData = {
        clerkToken,
        supabaseToken,
        timestamp: Date.now(),
      };
      await SecureStore.setItemAsync(TOKEN_CACHE_KEY, JSON.stringify(tokenData));
      log.debug('[AuthPersistence] Tokens saved securely');
    } catch (error) {
      log.error('[AuthPersistence] Failed to save tokens:', error);
    }
  }

  async getTokens(): Promise<{ clerkToken: string; supabaseToken: string } | null> {
    try {
      const stored = await SecureStore.getItemAsync(TOKEN_CACHE_KEY);
      if (!stored) return null;
      
      const tokenData = JSON.parse(stored);
      return {
        clerkToken: tokenData.clerkToken,
        supabaseToken: tokenData.supabaseToken,
      };
    } catch (error) {
      log.error('[AuthPersistence] Failed to get tokens:', error);
      return null;
    }
  }

  async clearAuthData(): Promise<void> {
    try {
      await AsyncStorage.removeItem(AUTH_STATE_KEY);
      await SecureStore.deleteItemAsync(TOKEN_CACHE_KEY);
      this.authState = null;
      log.debug('[AuthPersistence] Auth data cleared');
    } catch (error) {
      log.error('[AuthPersistence] Failed to clear auth data:', error);
    }
  }

  // Check if we need to validate auth (30-minute intervals)
  shouldValidateAuth(): boolean {
    if (!this.authState) return true;
    
    const thirtyMinutes = 30 * 60 * 1000;
    const timeSinceLastCheck = Date.now() - this.authState.lastAuthCheck;
    
    return timeSinceLastCheck > thirtyMinutes;
  }

  // Check if token is close to expiry (refresh at 25 minutes)
  shouldRefreshToken(): boolean {
    if (!this.authState) return true;
    
    const twentyFiveMinutes = 25 * 60 * 1000;
    const timeUntilExpiry = this.authState.tokenExpiry - Date.now();
    
    return timeUntilExpiry < twentyFiveMinutes;
  }
}
