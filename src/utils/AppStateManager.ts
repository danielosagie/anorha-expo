import { AppState, AppStateStatus } from 'react-native';
import { AuthPersistence } from './AuthPersistence';

export class AppStateManager {
  private static instance: AppStateManager;
  private appStateSubscription: any = null;
  private backgroundTimestamp: number | null = null;
  private onAuthValidationNeeded?: () => void;
  
  static getInstance(): AppStateManager {
    if (!AppStateManager.instance) {
      AppStateManager.instance = new AppStateManager();
    }
    return AppStateManager.instance;
  }

  initialize(onAuthValidationNeeded: () => void): void {
    this.onAuthValidationNeeded = onAuthValidationNeeded;
    this.setupAppStateListener();
  }

  private setupAppStateListener(): void {
    this.appStateSubscription = AppState.addEventListener('change', this.handleAppStateChange);
    console.log('[AppStateManager] App state listener initialized');
  }

  private handleAppStateChange = (nextAppState: AppStateStatus): void => {
    console.log('[AppStateManager] App state changed to:', nextAppState);
    
    if (nextAppState === 'background') {
      this.backgroundTimestamp = Date.now();
      console.log('[AppStateManager] App went to background');
    } else if (nextAppState === 'active' && this.backgroundTimestamp) {
      const backgroundDuration = Date.now() - this.backgroundTimestamp;
      const fiveMinutes = 5 * 60 * 1000;
      
      console.log('[AppStateManager] App returned to foreground after:', backgroundDuration / 1000, 'seconds');
      
      // If app was in background for more than 5 minutes, validate auth
      if (backgroundDuration > fiveMinutes) {
        console.log('[AppStateManager] App was backgrounded for >5 minutes, triggering auth validation');
        this.onAuthValidationNeeded?.();
      }
      
      this.backgroundTimestamp = null;
    }
  };

  cleanup(): void {
    if (this.appStateSubscription) {
      this.appStateSubscription.remove();
      this.appStateSubscription = null;
      console.log('[AppStateManager] App state listener cleaned up');
    }
  }
}
