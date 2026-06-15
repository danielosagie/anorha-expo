import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { createLogger } from '../utils/logger';
const log = createLogger('PlatformPickerOverlayContext');


export type StartConnectHandler = (platform: string) => void;

type PlatformPickerOverlayContextType = {
  visible: boolean;
  show: () => void;
  hide: () => void;
  enableForScreen: (onStartConnect: StartConnectHandler) => void;
  disableForScreen: () => void;
  onStartConnect?: StartConnectHandler;
};

const PlatformPickerOverlayContext = createContext<PlatformPickerOverlayContextType | undefined>(undefined);

export const PlatformPickerOverlayProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [visible, setVisible] = useState(false);
  const [onStartConnect, setOnStartConnect] = useState<StartConnectHandler | undefined>(undefined);

  // Debug: Log state changes
  useEffect(() => {
    log.debug('[PlatformPickerOverlayContext] visible changed to:', visible);
  }, [visible]);

  useEffect(() => {
    log.debug('[PlatformPickerOverlayContext] onStartConnect changed to:', !!onStartConnect);
  }, [onStartConnect]);

  const show = useCallback(() => {
    log.debug('[PlatformPickerOverlayContext] show() called');
    setVisible(true);
  }, []);
  const hide = useCallback(() => {
    log.debug('[PlatformPickerOverlayContext] hide() called');
    setVisible(false);
  }, []);
  const enableForScreen = useCallback((handler: StartConnectHandler) => {
    setOnStartConnect(() => handler);
  }, []);
  const disableForScreen = useCallback(() => {
    log.debug('[PlatformPickerOverlayContext] disableForScreen() called');
    setOnStartConnect(undefined);
    // Don't automatically hide - let the user explicitly call hide()
    // setVisible(false);
  }, []);

  const value = useMemo(() => ({ visible, show, hide, enableForScreen, disableForScreen, onStartConnect }), [visible, show, hide, enableForScreen, disableForScreen, onStartConnect]);

  return (
    <PlatformPickerOverlayContext.Provider value={value}>
      {children}
    </PlatformPickerOverlayContext.Provider>
  );
};

export const usePlatformPickerOverlay = (): PlatformPickerOverlayContextType => {
  const ctx = useContext(PlatformPickerOverlayContext);
  if (!ctx) throw new Error('usePlatformPickerOverlay must be used within PlatformPickerOverlayProvider');
  return ctx;
};
