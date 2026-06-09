import React, { useState } from 'react';
import {
    View,
    Text,
    StyleSheet,
    TouchableOpacity,
    ActivityIndicator,
    SafeAreaView,
    Dimensions,
    ScrollView,
} from 'react-native';
import { useOrganizationList } from '@clerk/clerk-expo';
import { showMessage } from 'react-native-flash-message';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

const { width } = Dimensions.get('window');
const BG_COLOR = '#FFFCF5';
const CARD_BG = '#FFFFFF';

const PendingOrgInvitesScreen = ({ navigation }: { navigation: any }) => {
    const { userInvitations, userMemberships, isLoaded, setActive } = useOrganizationList({
        userInvitations: {
            infinite: true,
            keepPreviousData: true,
        },
        userMemberships: {
            infinite: true,
        },
    });

    const [processingId, setProcessingId] = useState<string | null>(null);

    const handleAccept = async (invitation: any) => {
        setProcessingId(invitation.id);
        try {
            const acceptedInvitation = await invitation.accept();

            if (setActive) {
                await setActive({
                    organization: acceptedInvitation.publicOrganization.id,
                });
            }

            showMessage({
                message: "Invite Accepted",
                description: `You are now a member of ${invitation.publicOrganizationData.name}`,
                type: "success",
            });

            navigation.reset({
                index: 0,
                routes: [{ name: 'TabNavigator' }],
            });
        } catch (err: any) {
            console.error('Error accepting invitation:', err);
            showMessage({
                message: "Error",
                description: err.message || "Failed to accept invitation",
                type: "danger",
            });
        } finally {
            setProcessingId(null);
        }
    };

    const handleDecline = async (invitation: any) => {
        setProcessingId(invitation.id);
        try {
            await invitation.reject();
            showMessage({
                message: "Invite Declined",
                type: "info",
            });
        } catch (err: any) {
            console.error('Error declining invitation:', err);
            showMessage({
                message: "Error",
                description: "Failed to decline invitation",
                type: "danger",
            });
        } finally {
            setProcessingId(null);
        }
    };

    if (!isLoaded) {
        return (
            <View style={[styles.container, styles.center]}>
                <ActivityIndicator size="large" color="#1a1a1a" />
            </View>
        );
    }

    const invitations = userInvitations?.data || [];
    const hasOrgs = (userMemberships?.data?.length || 0) > 0;

    if (invitations.length === 0) {
        return (
            <SafeAreaView style={styles.container}>
                <View style={styles.emptyContainer}>
                    <View style={styles.iconCircle}>
                        <Icon name="email-outline" size={40} color="#1a1a1a" />
                    </View>
                    <Text style={styles.emptyTitle}>No pending invites</Text>
                    <Text style={styles.emptySubtitle}>You don't have any organization invitations at the moment.</Text>

                    {hasOrgs ? (
                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => navigation.reset({
                                index: 0,
                                routes: [{ name: 'TabNavigator' }],
                            })}
                        >
                            <Text style={styles.primaryButtonText}>Go to Dashboard</Text>
                        </TouchableOpacity>
                    ) : (
                        <TouchableOpacity
                            style={styles.primaryButton}
                            onPress={() => navigation.navigate('CreateAccountScreen')}
                        >
                            <Text style={styles.primaryButtonText}>Create your own Org</Text>
                        </TouchableOpacity>
                    )}

                    {hasOrgs && (
                        <TouchableOpacity
                            style={[styles.textActionButton, { marginTop: 16 }]}
                            onPress={() => navigation.navigate('CreateAccountScreen')}
                        >
                            <Text style={styles.textActionText}>Create a new organization</Text>
                        </TouchableOpacity>
                    )}
                </View>
            </SafeAreaView>
        );
    }

    return (
        <SafeAreaView style={styles.container}>
            <ScrollView contentContainerStyle={styles.scrollContent} showsVerticalScrollIndicator={false}>
                <View style={styles.header}>
                    <Text style={styles.headerTitle}>Invitation Pending</Text>
                    <Text style={styles.headerSubtitle}>
                        An organization has invited you to join their workspace.
                    </Text>
                </View>

                {invitations.map((invite) => (
                    <View key={invite.id} style={styles.inviteCard}>
                        <View style={styles.cardImageContainer}>
                            <View style={styles.placeholderImage}>
                                <Icon name="office-building" size={80} color="#E0E0E0" />
                                <View style={styles.badge}>
                                    <Text style={styles.badgeText}>Pending</Text>
                                </View>
                            </View>
                        </View>

                        <View style={styles.cardContent}>
                            <Text style={styles.orgName}>{invite.publicOrganizationData.name}</Text>
                            <View style={styles.detailRow}>
                                <Icon name="account-details-outline" size={18} color="#666" />
                                <Text style={styles.detailText}>Role: {invite.role === 'admin' ? 'Administrator' : 'Member'}</Text>
                            </View>
                            <View style={styles.detailRow}>
                                <Icon name="calendar-clock" size={18} color="#666" />
                                <Text style={styles.detailText}>Received: {new Date(invite.createdAt).toLocaleDateString()}</Text>
                            </View>

                            <View style={styles.actionRow}>
                                <TouchableOpacity
                                    style={[styles.primaryButton, processingId === invite.id && styles.disabled]}
                                    onPress={() => handleAccept(invite)}
                                    disabled={!!processingId}
                                >
                                    {processingId === invite.id ? (
                                        <ActivityIndicator color="#fff" />
                                    ) : (
                                        <Text style={styles.primaryButtonText}>Accept Invite</Text>
                                    )}
                                </TouchableOpacity>

                                <TouchableOpacity
                                    style={[styles.secondaryButton, processingId === invite.id && styles.disabled]}
                                    onPress={() => handleDecline(invite)}
                                    disabled={!!processingId}
                                >
                                    <Text style={styles.secondaryButtonText}>Decline</Text>
                                </TouchableOpacity>
                            </View>
                        </View>
                    </View>
                ))}

                <TouchableOpacity
                    style={styles.textActionButton}
                    onPress={() => navigation.navigate('CreateAccountScreen')}
                >
                    <Text style={styles.textActionText}>Or create your own business instead</Text>
                </TouchableOpacity>
            </ScrollView>
        </SafeAreaView>
    );
};

const styles = StyleSheet.create({
    container: {
        flex: 1,
        backgroundColor: BG_COLOR,
    },
    center: {
        justifyContent: 'center',
        alignItems: 'center',
    },
    scrollContent: {
        padding: 24,
    },
    header: {
        marginBottom: 32,
        marginTop: 20,
    },
    headerTitle: {
        fontSize: 34,
        fontFamily: 'Inter_700Bold',
        color: '#1a1a1a',
        marginBottom: 12,
    },
    headerSubtitle: {
        fontSize: 17,
        fontFamily: 'Inter_400Regular',
        color: '#666',
        lineHeight: 24,
    },
    inviteCard: {
        backgroundColor: CARD_BG,
        borderRadius: 28,
        overflow: 'hidden',
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 10 },
        shadowOpacity: 0.05,
        shadowRadius: 20,
        elevation: 4,
        borderWidth: 1,
        borderColor: '#F0F0F0',
        marginBottom: 24,
    },
    cardImageContainer: {
        height: 200,
        backgroundColor: '#F9F9F9',
    },
    placeholderImage: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        backgroundColor: '#F5F5F5',
    },
    badge: {
        position: 'absolute',
        top: 16,
        left: 16,
        backgroundColor: '#fff',
        paddingHorizontal: 12,
        paddingVertical: 6,
        borderRadius: 12,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 2 },
        shadowOpacity: 0.1,
        shadowRadius: 4,
        elevation: 2,
    },
    badgeText: {
        fontSize: 13,
        fontFamily: 'Inter_700Bold',
        color: '#1a1a1a',
    },
    cardContent: {
        padding: 24,
    },
    orgName: {
        fontSize: 24,
        fontFamily: 'Inter_700Bold',
        color: '#1a1a1a',
        marginBottom: 16,
    },
    detailRow: {
        flexDirection: 'row',
        alignItems: 'center',
        marginBottom: 8,
        gap: 10,
    },
    detailText: {
        fontSize: 15,
        fontFamily: 'Inter_400Regular',
        color: '#666',
    },
    actionRow: {
        marginTop: 24,
        gap: 12,
    },
    primaryButton: {
        backgroundColor: '#1a1a1a',
        borderRadius: 16,
        height: 56,
        justifyContent: 'center',
        alignItems: 'center',
    },
    primaryButtonText: {
        color: '#fff',
        fontSize: 17,
        fontFamily: 'Inter_700Bold',
    },
    secondaryButton: {
        backgroundColor: 'transparent',
        borderRadius: 16,
        height: 56,
        justifyContent: 'center',
        alignItems: 'center',
        borderWidth: 1,
        borderColor: '#E0E0E0',
    },
    secondaryButtonText: {
        color: '#1a1a1a',
        fontSize: 17,
        fontFamily: 'Inter_600SemiBold',
    },
    emptyContainer: {
        flex: 1,
        justifyContent: 'center',
        alignItems: 'center',
        padding: 32,
    },
    iconCircle: {
        width: 80,
        height: 80,
        borderRadius: 40,
        backgroundColor: '#fff',
        justifyContent: 'center',
        alignItems: 'center',
        marginBottom: 24,
        shadowColor: '#000',
        shadowOffset: { width: 0, height: 4 },
        shadowOpacity: 0.1,
        shadowRadius: 10,
        elevation: 3,
    },
    emptyTitle: {
        fontSize: 24,
        fontFamily: 'Inter_700Bold',
        color: '#1a1a1a',
        marginBottom: 12,
    },
    emptySubtitle: {
        fontSize: 16,
        fontFamily: 'Inter_400Regular',
        color: '#666',
        textAlign: 'center',
        marginBottom: 32,
    },
    disabled: {
        opacity: 0.6,
    },
    textActionButton: {
        marginTop: 8,
        padding: 12,
        alignItems: 'center',
    },
    textActionText: {
        fontSize: 15,
        fontFamily: 'Inter_600SemiBold',
        color: '#666',
        textDecorationLine: 'underline',
    }
});

export default PendingOrgInvitesScreen;
