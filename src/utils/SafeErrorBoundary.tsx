import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet } from 'react-native';
import * as Sentry from '@sentry/react-native';
import { createLogger } from './logger';
const log = createLogger('SafeErrorBoundary');


interface Props {
  children: React.ReactNode;
  fallback?: React.ReactNode;
  /**
   * Escape hatch for a deterministic throw. A plain "Try Again" just re-renders the same
   * tree, so a throw that reproduces on every render traps the user in an infinite loop.
   * After 2 failed resets the button becomes "Go home" and calls this (e.g. reset
   * navigation to the root tab navigator) to break out of the offending subtree.
   */
  onGoHome?: () => void;
}

interface State {
  hasError: boolean;
  error?: Error;
  /** Failed "Try Again" resets so far. After 2, the button switches to "Go home". */
  resetCount: number;
}

export class SafeErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, resetCount: 0 };
  }

  static getDerivedStateFromError(error: Error): Partial<State> {
    // Merge — leaves resetCount intact so repeated throws count toward the "Go home" swap.
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    log.error('[SafeErrorBoundary] Caught error:', error, errorInfo);
    try {
      Sentry.captureException(error, {
        extra: { componentStack: errorInfo?.componentStack },
      });
    } catch {
      // never let crash reporting itself crash the fallback UI
    }
  }

  handleTryAgain = () => {
    this.setState((s) => ({ hasError: false, error: undefined, resetCount: s.resetCount + 1 }));
  };

  handleGoHome = () => {
    try {
      this.props.onGoHome?.();
    } catch {
      // navigation may be unavailable (e.g. a provider threw before the nav tree mounted);
      // clearing state below is still a better outcome than a frozen fallback.
    }
    this.setState({ hasError: false, error: undefined, resetCount: 0 });
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const goHome = this.state.resetCount >= 2;
      return (
        <View style={styles.container}>
          <Text style={styles.title}>Something went wrong</Text>
          <Text style={styles.message}>
            {this.state.error?.message || 'An unexpected error occurred'}
          </Text>
          <TouchableOpacity
            style={styles.button}
            onPress={goHome ? this.handleGoHome : this.handleTryAgain}
          >
            <Text style={styles.buttonText}>{goHome ? 'Go home' : 'Try Again'}</Text>
          </TouchableOpacity>
        </View>
      );
    }

    return this.props.children;
  }
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
    backgroundColor: '#F2F2F7',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    marginBottom: 16,
    textAlign: 'center',
  },
  message: {
    fontSize: 16,
    color: '#666',
    textAlign: 'center',
    marginBottom: 32,
    lineHeight: 22,
  },
  button: {
    backgroundColor: '#007AFF',
    paddingHorizontal: 32,
    paddingVertical: 12,
    borderRadius: 8,
  },
  buttonText: {
    color: '#FFF',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default SafeErrorBoundary;
