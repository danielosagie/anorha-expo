import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet, Switch, ScrollView, Alert, TouchableOpacity, ActivityIndicator } from 'react-native';
import { useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { useAuth } from '@clerk/clerk-expo';
import { API_BASE_URL } from '../config/env';

export default function NotificationSettingsScreen() {
    const { colors } = useTheme();
    const navigation = useNavigation();
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
            const token = await getToken({ template: process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE || 'supabase' });
            const apiBaseUrl = API_BASE_URL;
            if (!apiBaseUrl) {
                console.warn('API Base URL not found');
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
            console.error('Failed to load notification preferences:', err);
        } finally {
            setLoading(false);
        }
    };

    const togglePreference = async (key: keyof typeof preferences) => {
        const newValue = !preferences[key];
        setPreferences(prev => ({ ...prev, [key]: newValue }));

        try {
            const token = await getToken({ template: process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE || 'supabase' });
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
            console.error('Failed to update preference:', err);
            // Revert on error
            setPreferences(prev => ({ ...prev, [key]: !newValue }));
            Alert.alert('Error', 'Failed to save setting');
        }
    };

    const sendTestNotification = async () => {
        try {
            setTestSending(true);
            const token = await getToken({ template: process.env.EXPO_PUBLIC_CLERK_JWT_TEMPLATE || 'supabase' });
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
                console.warn('[NotificationSettings] Test failed:', res.status, body);
            }
        } catch (err: any) {
            console.error('Test notification error:', err);
            Alert.alert('Error', err?.message || 'Failed to send test notification');
        } finally {
            setTestSending(false);
        }
    };

    const Option = ({ label, description, value, onValueChange, icon }: any) => (
        <View style={[styles.optionContainer, { backgroundColor: colors.surface, borderColor: 'rgba(0,0,0,0.05)' }]}>
            <View style={styles.optionHeader}>
                <View style={styles.optionIconContainer}>
                    <Icon name={icon} size={24} color={colors.primary} />
                </View>
                <View style={styles.optionTextContainer}>
                    <Text style={[styles.optionLabel, { color: colors.text }]}>{label}</Text>
                    <Text style={[styles.optionDescription, { color: colors.textSecondary }]}>{description}</Text>
                </View>
                <Switch
                    value={value}
                    onValueChange={onValueChange}
                    trackColor={{ false: '#767577', true: colors.primary }}
                    thumbColor={value ? '#fff' : '#f4f3f4'}
                />
            </View>
        </View>
    );

    return (
        <View style={[styles.container, { backgroundColor: colors.background }]}>
            <View style={[styles.header, { borderBottomColor: 'rgba(0,0,0,0.05)' }]}>
                <TouchableOpacity onPress={() => navigation.goBack()} style={styles.backButton}>
                    <Icon name="arrow-left" size={24} color={colors.text} />
                </TouchableOpacity>
                <Text style={[styles.headerTitle, { color: colors.text }]}>Notifications</Text>
            </View>

            {loading ? (
                <View style={styles.center}>
                    <ActivityIndicator size="large" color={colors.primary} />
                </View>
            ) : (
                <ScrollView contentContainerStyle={styles.content}>
                    <Option
                        label="Job Completions"
                        description="Get notified when AI generation, matching, or scanning finishes."
                        value={preferences.JobCompletions}
                        onValueChange={() => togglePreference('JobCompletions')}
                        icon="check-circle-outline"
                    />

                    <Option
                        label="Shared Inventory"
                        description="When partners share new inventory with you."
                        value={preferences.InventorySharing}
                        onValueChange={() => togglePreference('InventorySharing')}
                        icon="package-variant"
                    />

                    <Option
                        label="Sprout Insights"
                        description="AI-driven insights and opportunities."
                        value={preferences.SproutInsights}
                        onValueChange={() => togglePreference('SproutInsights')}
                        icon="sprout-outline"
                    />

                    <Option
                        label="Sync Alerts"
                        description="Critical issues with platform connections."
                        value={preferences.SyncAlerts}
                        onValueChange={() => togglePreference('SyncAlerts')}
                        icon="alert-circle-outline"
                    />

                    <Option
                        label="Marketing Updates"
                        description="News and updates about Anorha."
                        value={preferences.MarketingUpdates}
                        onValueChange={() => togglePreference('MarketingUpdates')}
                        icon="bullhorn-outline"
                    />

                    <View style={[styles.testSection, { backgroundColor: colors.surface, borderColor: 'rgba(0,0,0,0.05)' }]}>
                        <Text style={[styles.testLabel, { color: colors.text }]}>Test push</Text>
                        <Text style={[styles.testDescription, { color: colors.textSecondary }]}>
                            Send a test notification to this device to verify push is working.
                        </Text>
                        <TouchableOpacity
                            style={[styles.testButton, { backgroundColor: colors.primary }]}
                            onPress={sendTestNotification}
                            disabled={testSending}
                        >
                            {testSending ? (
                                <ActivityIndicator size="small" color="#fff" />
                            ) : (
                                <Text style={styles.testButtonText}>Send test notification</Text>
                            )}
                        </TouchableOpacity>
                    </View>

                </ScrollView>
            )}
        </View>
    );
}

const styles = StyleSheet.create({
    container: {
        flex: 1,
    },
    header: {
        paddingTop: 60,
        paddingBottom: 16,
        paddingHorizontal: 20,
        flexDirection: 'row',
        alignItems: 'center',
        borderBottomWidth: 1,
    },
    backButton: {
        marginRight: 16,
    },
    headerTitle: {
        fontSize: 20,
        fontWeight: 'bold',
    },
    center: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
    },
    content: {
        padding: 20,
    },
    optionContainer: {
        borderRadius: 12,
        marginBottom: 16,
        borderWidth: 1,
        padding: 16,
    },
    optionHeader: {
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
    },
    optionIconContainer: {
        width: 40,
        alignItems: 'center',
    },
    optionTextContainer: {
        flex: 1,
        paddingHorizontal: 12,
    },
    optionLabel: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    optionDescription: {
        fontSize: 13,
        lineHeight: 18,
    },
    testSection: {
        borderRadius: 12,
        marginTop: 8,
        marginBottom: 24,
        borderWidth: 1,
        padding: 16,
    },
    testLabel: {
        fontSize: 16,
        fontWeight: '600',
        marginBottom: 4,
    },
    testDescription: {
        fontSize: 13,
        lineHeight: 18,
        marginBottom: 12,
    },
    testButton: {
        paddingVertical: 12,
        paddingHorizontal: 16,
        borderRadius: 8,
        alignItems: 'center',
    },
    testButtonText: {
        color: '#fff',
        fontSize: 16,
        fontWeight: '600',
    },
});
