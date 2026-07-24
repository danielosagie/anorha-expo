import { UIManager } from 'react-native';

const hasNativeView = (name: string): boolean => {
  try {
    return UIManager.hasViewManagerConfig(name);
  } catch {
    return false;
  }
};

// Resolve this once when the bundle loads. Older dev clients do not contain
// react-native-teleport's Fabric views, so none of its components may mount.
export const TELEPORT_AVAILABLE =
  hasNativeView('PortalHostView') && hasNativeView('PortalView');

