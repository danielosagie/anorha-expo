import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, Alert, TouchableOpacity, ActivityIndicator, StatusBar } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { CheckCircle2, Package, Sprout, AlertTriangle, Megaphone } from 'lucide-react-native';
import { useAuth } from '@clerk/expo';
import { API_BASE_URL } from '../config/env';
import PageHeader from '../components/ui/PageHeader';
import { createLogger } from '../utils/logger';
const log = createLogger('NotificationSettingsScreen');


export default function NotificationSettingsScreen() {
    const navigation = useNavigation();
    const insets = useSafeAreaInsets();
    const { getToken } = useAuth();

    const [loading, setLoading] = useState(true);
    const [testSending, setTestSending] = useState(false);
    const [preferences, setPreferences] = useState({
        JobCompletions: true,
        InventorySharing: true,
        SproutInsights: true,
        SyncAlerts: true,
        MarketingUpdates: false,
    });

    useEffect(() => {
        loadPreferences();
    }, []);

    const loadPreferences = async () => {
        try {
            setLoading(true);
            const token = await getToken();
            const apiBaseUrl = API_BASE_URL;
            if (!apiBaseUrl) {
                log.warn('API Base URL not found');
                setLoading(false);
                return;
            }

            const res = await fetch(`${apiBaseUrl}/api/notifications/preferences`, {
                headers: { Authorization: `Bearer ${token}` }
            });

            if (res.ok) {
                const data = await res.json();
                setPreferences({
                    JobCompletions: data.jobCompletions ?? true,
                    InventorySharing: data.inventorySharing ?? true,
                    SproutInsights: data.sproutInsights ?? true,
                    SyncAlerts: data.syncAlerts ?? true,
                    MarketingUpdates: data.marketingUpdates ?? false,
                });
            }
        } catch (err) {
            log.error('Failed to load notification preferences:', err);
        } finally {
            setLoading(false);
        }
    };

    const togglePreference = async (key: keyof typeof preferences) => {
        const newValue = !preferences[key];
        setPreferences(prev => ({ ...prev, [key]: newValue }));

        try {
            const token = await getToken();
            const apiBaseUrl = API_BASE_URL;

            // Map frontend key (PascalCase) to backend key (camelCase)
            const backendKey = key.charAt(0).toLowerCase() + key.slice(1);

            await fetch(`${apiBaseUrl}/api/notifications/preferences`, {
                method: 'PATCH',
                headers: {
                    Authorization: `Bearer ${token}`,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({ [backendKey]: newValue })
            });
        } catch (err) {
            log.error('Failed to update preference:', err);
            // Revert on error
            setPreferences(prev => ({ ...prev, [key]: !newValue }));
            Alert.alert('Error', 'Failed to save setting');
        }
    };

    const sendTestNotification = async () => {
        try {
            setTestSending(true);
            const token = await getToken();
            const apiBaseUrl = API_BASE_URL;
            if (!apiBaseUrl) {
                Alert.alert('Error', 'API base URL not configured');
                return;
            }
            const res = await fetch(`${apiBaseUrl}/api/notifications/test`, {
                method: 'POST',
                headers: { Authorization: `Bearer ${token}` },
            });
            if (res.ok) {
                Alert.alert('Sent', 'If push is set up correctly, you should get a test notification shortly.');
            } else {
                const body = await res.text();
                Alert.alert('Request failed', `Server returned ${res.status}. Check that your device is registered (open the app and stay on the main tabs).`);
                log.warn('[NotificationSettings] Test failed:', res.status, body);
            }
        } catch (err: any) {
            log.error('Test notification error:', err);
            Alert.alert('Error', err?.message || 'Failed to send test notification');
        } finally {
            setTestSending(false);
        }
    };

    const Option = ({ label, description, value, onValueChange, icon, first }: any) => (
        <View style={[styles.row, !first && styles.rowDivider]}>
            <View style={styles.rowIcon}>{icon}</View>
            <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{label}</Text>
                <Text style={styles.rowDescription}>{description}</Text>
            </View>
            <Switch
                value={value}
                onValueChange={onValueChange}
                trackColor={{ false: '#D4D4D8', true: '#93C822' }}
                thumbColor="#FFFFFF"
            />
        </View>
    );

    return (
        <View style={styles.root}>
            <StatusBar barStyle="dark-content" />
            <ScrollView
                contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 120 }}
                showsVerticalScrollIndicator={false}
            >
                <PageHeader title="Notifications" onBack={() => navigation.goBack()} />

                {loading ? (
                    <View style={styles.center}>
                        <ActivityIndicator size="large" color="#93C822" />
                    </View>
                ) : (
                    <>
                        <Text style={styles.sectionLabel}>Push notifications</Text>
                        <View style={styles.listCard}>
                            <Option
                                first
                                label="Job Completions"
                                description="Get notified when AI generation, matching, or scanning finishes."
                                value={preferences.JobCompletions}
                                onValueChange={() => togglePreference('JobCompletions')}
                                icon={<CheckCircle2 size={22} color="#18181B" />}
                            />
                            <Option
                                label="Shared Inventory"
                                description="When partners share new inventory with you."
                                value={preferences.InventorySharing}
                                onValueChange={() => togglePreference('InventorySharing')}
                                icon={<Package size={22} color="#18181B" />}
                            />
                            <Option
                                label="Sprout Insights"
                                description="AI-driven insights and opportunities."
                                value={preferences.SproutInsights}
                                onValueChange={() => togglePreference('SproutInsights')}
                                icon={<Sprout size={22} color="#18181B" />}
                            />
                            <Option
                                label="Sync Alerts"
                                description="Critical issues with platform connections."
                                value={preferences.SyncAlerts}
                                onValueChange={() => togglePreference('SyncAlerts')}
                                icon={<AlertTriangle size={22} color="#18181B" />}
                            />
                            <Option
                                label="Marketing Updates"
                                description="News and updates about Anorha."
                                value={preferences.MarketingUpdates}
                                onValueChange={() => togglePreference('MarketingUpdates')}
                                icon={<Megaphone size={22} color="#18181B" />}
                            />
                        </View>

                        <Text style={styles.sectionLabel}>Test push</Text>
                        <View style={styles.testCard}>
                            <Text style={styles.rowTitle}>Verify push delivery</Text>
                            <Text style={styles.rowDescription}>
                                Send a test notification to this device to verify push is working.
                            </Text>
                            <TouchableOpacity
                                style={styles.testButton}
                                onPress={sendTestNotification}
                                disabled={testSending}
                                activeOpacity={0.85}
                            >
                                {testSending ? (
                                    <ActivityIndicator size="small" color="#fff" />
                                ) : (
                                    <Text style={styles.testButtonText}>Send test notification</Text>
                                )}
                            </TouchableOpacity>
                        </View>
                    </>
                )}
            </ScrollView>
        </View>
    );
}

const styles = StyleSheet.create({
    root: {
        flex: 1,
        backgroundColor: '#F6F7F4',
    },
    center: {
        paddingVertical: 80,
        alignItems: 'center',
        justifyContent: 'center',
    },
    sectionLabel: {
        fontSize: 13,
        fontFamily: 'Inter_600SemiBold',
        color: '#71717A',
        textTransform: 'uppercase',
        letterSpacing: 0.5,
        marginBottom: 10,
        marginLeft: 4,
    },
    listCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        paddingHorizontal: 16,
        borderWidth: 1,
        borderColor: '#ECEBE6',
        marginBottom: 24,
    },
    row: {
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        paddingVertical: 14,
    },
    rowDivider: {
        borderTopWidth: 1,
        borderTopColor: '#F1F1EE',
    },
    rowIcon: {
        width: 28,
        alignItems: 'center',
    },
    rowText: {
        flex: 1,
    },
    rowTitle: {
        fontSize: 16,
        fontFamily: 'Inter_600SemiBold',
        color: '#18181B',
    },
    rowDescription: {
        fontSize: 13,
        fontFamily: 'Inter_400Regular',
        color: '#71717A',
        marginTop: 2,
    },
    testCard: {
        backgroundColor: '#FFFFFF',
        borderRadius: 20,
        padding: 16,
        borderWidth: 1,
        borderColor: '#ECEBE6',
    },
    testButton: {
        backgroundColor: '#93C822',
        borderRadius: 16,
        paddingVertical: 15,
        alignItems: 'center',
        justifyContent: 'center',
        marginTop: 14,
    },
    testButtonText: {
        color: '#FFFFFF',
        fontSize: 15,
        fontFamily: 'Inter_700Bold',
    },
});
