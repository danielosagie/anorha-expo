import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';
import SystemAlert, { SystemAlertOptions } from '../components/SystemAlert';
import SystemToast, { SystemToastOptions } from '../components/SystemToast';
import SystemWelcomeModal, { SystemWelcomeOptions } from '../components/SystemWelcomeModal';

interface SystemNotificationContextType {
    showAlert: (options: SystemAlertOptions) => void;
    showToast: (options: SystemToastOptions) => void;
    showWelcome: (options: SystemWelcomeOptions) => void;
    hideAlert: () => void;
    hideToast: () => void;
    hideWelcome: () => void;
}

const SystemNotificationContext = createContext<SystemNotificationContextType | undefined>(undefined);

export const useSystemNotifications = () => {
    const context = useContext(SystemNotificationContext);
    if (!context) {
        throw new Error('useSystemNotifications must be used within a SystemNotificationProvider');
    }
    return context;
};

export const SystemNotificationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    const [alertOptions, setAlertOptions] = useState<SystemAlertOptions | null>(null);
    const [toastOptions, setToastOptions] = useState<SystemToastOptions | null>(null);
    const [welcomeOptions, setWelcomeOptions] = useState<SystemWelcomeOptions | null>(null);

    const showAlert = useCallback((options: SystemAlertOptions) => {
        setAlertOptions(options);
    }, []);

    const hideAlert = useCallback(() => {
        setAlertOptions(null);
    }, []);

    const showToast = useCallback((options: SystemToastOptions) => {
        setToastOptions(options);
    }, []);

    const hideToast = useCallback(() => {
        setToastOptions(null);
    }, []);

    const showWelcome = useCallback((options: SystemWelcomeOptions) => {
        setWelcomeOptions(options);
    }, []);

    const hideWelcome = useCallback(() => {
        setWelcomeOptions(null);
    }, []);

    return (
        <SystemNotificationContext.Provider value={{
            showAlert,
            showToast,
            showWelcome,
            hideAlert,
            hideToast,
            hideWelcome
        }}>
            {children}
            {alertOptions && (
                <SystemAlert
                    visible={!!alertOptions}
                    options={alertOptions}
                    onClose={hideAlert}
                />
            )}
            {toastOptions && (
                <SystemToast
                    visible={!!toastOptions}
                    options={toastOptions}
                    onClose={hideToast}
                />
            )}
            {welcomeOptions && (
                <SystemWelcomeModal
                    visible={!!welcomeOptions}
                    options={welcomeOptions}
                    onClose={hideWelcome}
                />
            )}
        </SystemNotificationContext.Provider>
    );
};
