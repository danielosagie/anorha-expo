import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  Alert,
} from 'react-native';
import { useRoute, useNavigation } from '@react-navigation/native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import Button from '../components/Button';
import AnimatedGradientBackground from '../components/AnimatedGradientBackground';
import { ensureSupabaseJwt } from '../lib/supabase';

const API_BASE_URL = 'https://api.sssync.app';

interface RouteParams {
  inviteCode?: string;
  inviteId?: string;
}

type AcceptStatus = 'loading' | 'ready' | 'accepting' | 'success' | 'error';

const PartnerAcceptScreen: React.FC = () => {
  const theme = useTheme();
  const route = useRoute();
  const navigation = useNavigation<any>();
  
  const { inviteCode, inviteId } = (route.params as RouteParams) || {};
  
  const [status, setStatus] = useState<AcceptStatus>('loading');
  const [inviteDetails, setInviteDetails] = useState<{
    orgName?: string;
    locationName?: string;
    inviterName?: string;
    expiresAt?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInviteDetails();
  }, [inviteCode, inviteId]);

  const loadInviteDetails = async () => {
    if (!inviteCode && !inviteId) {
      setError('Invalid invite link');
      setStatus('error');
      return;
    }

    try {
      setStatus('loading');
      const token = await ensureSupabaseJwt();
      
      const response = await fetch(
        `${API_BASE_URL}/api/partner-invites/preview?${inviteCode ? `code=${inviteCode}` : `id=${inviteId}`}`,
        {
          headers: {
            'Authorization': `Bearer ${token}`,
          },
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to load invite details');
      }

      const data = await response.json();
      setInviteDetails(data);
      setStatus('ready');
    } catch (err: any) {
      console.error('[PartnerAcceptScreen] Error loading invite:', err);
      setError(err.message || 'Failed to load invite');
      setStatus('error');
    }
  };

  const handleAccept = async () => {
    try {
      setStatus('accepting');
      const token = await ensureSupabaseJwt();
      
      const response = await fetch(
        `${API_BASE_URL}/api/partner-invites/accept`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            inviteCode,
            inviteId,
          }),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to accept invite');
      }

      setStatus('success');
      
      // Navigate to dashboard after a short delay
      setTimeout(() => {
        navigation.reset({
          index: 0,
          routes: [{ name: 'TabNavigator', params: { screen: 'Inventory' } }],
        });
      }, 2000);
    } catch (err: any) {
      console.error('[PartnerAcceptScreen] Error accepting invite:', err);
      setError(err.message || 'Failed to accept invite');
      setStatus('error');
    }
  };

  const handleDecline = () => {
    Alert.alert(
      'Decline Invite',
      'Are you sure you want to decline this partner invitation?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Decline',
          style: 'destructive',
          onPress: () => {
            navigation.goBack();
          },
        },
      ]
    );
  };

  const renderContent = () => {
    if (status === 'loading') {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color="#fff" />
          <Text style={styles.loadingText}>Loading invite details...</Text>
        </View>
      );
    }

    if (status === 'success') {
      return (
        <View style={styles.centerContent}>
          <View style={styles.successIcon}>
            <Icon name="check-circle" size={64} color="#8BC34A" />
          </View>
          <Text style={styles.title}>Welcome, Partner!</Text>
          <Text style={styles.description}>
            You now have access to {inviteDetails?.locationName || 'the shared inventory'}.
            {'\n'}Redirecting to your dashboard...
          </Text>
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={styles.centerContent}>
          <View style={styles.errorIcon}>
            <Icon name="alert-circle" size={64} color="#FF5252" />
          </View>
          <Text style={styles.title}>Oops!</Text>
          <Text style={styles.description}>{error || 'Something went wrong'}</Text>
          <Button
            title="Try Again"
            onPress={loadInviteDetails}
            style={styles.retryButton}
          />
          <Button
            title="Go Back"
            onPress={() => navigation.goBack()}
            outlined
            style={styles.backButton}
          />
        </View>
      );
    }

    // Ready state - show invite details
    return (
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Icon name="account-group" size={48} color="#fff" />
        </View>
        
        <Text style={styles.title}>Partner Invitation</Text>
        
        <View style={styles.inviteCard}>
          {inviteDetails?.inviterName && (
            <View style={styles.detailRow}>
              <Icon name="account" size={20} color={theme.colors.primary} />
              <Text style={styles.detailLabel}>From:</Text>
              <Text style={styles.detailValue}>{inviteDetails.inviterName}</Text>
            </View>
          )}
          
          {inviteDetails?.orgName && (
            <View style={styles.detailRow}>
              <Icon name="domain" size={20} color={theme.colors.primary} />
              <Text style={styles.detailLabel}>Organization:</Text>
              <Text style={styles.detailValue}>{inviteDetails.orgName}</Text>
            </View>
          )}
          
          {inviteDetails?.locationName && (
            <View style={styles.detailRow}>
              <Icon name="map-marker" size={20} color={theme.colors.primary} />
              <Text style={styles.detailLabel}>Location:</Text>
              <Text style={styles.detailValue}>{inviteDetails.locationName}</Text>
            </View>
          )}
        </View>

        <Text style={styles.description}>
          You've been invited to become a partner. As a partner, you'll be able to view and manage 
          inventory for the shared location.
        </Text>

        <View style={styles.buttonGroup}>
          <Button
            title="Accept Invitation"
            onPress={handleAccept}
            loading={status === 'accepting'}
            style={styles.acceptButton}
          />
          <Button
            title="Decline"
            onPress={handleDecline}
            outlined
            style={styles.declineButton}
          />
        </View>
      </View>
    );
  };

  return (
    <View style={styles.container}>
      <AnimatedGradientBackground style={StyleSheet.absoluteFill} />
      {renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  content: {
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
    padding: 20,
  },
  centerContent: {
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 255, 255, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  successIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(139, 195, 74, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  errorIcon: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: 'rgba(255, 82, 82, 0.2)',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    textAlign: 'center',
    marginBottom: 16,
  },
  inviteCard: {
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.15,
    shadowRadius: 12,
    elevation: 5,
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
    gap: 12,
  },
  detailLabel: {
    fontSize: 14,
    color: '#666',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    color: '#333',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  description: {
    fontSize: 15,
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  loadingText: {
    fontSize: 16,
    color: 'rgba(255, 255, 255, 0.9)',
    marginTop: 16,
  },
  buttonGroup: {
    width: '100%',
    gap: 12,
  },
  acceptButton: {
    backgroundColor: '#8BC34A',
  },
  declineButton: {
    borderColor: 'rgba(255, 255, 255, 0.5)',
  },
  retryButton: {
    backgroundColor: '#8BC34A',
    marginTop: 24,
    paddingHorizontal: 32,
  },
  backButton: {
    borderColor: 'rgba(255, 255, 255, 0.5)',
    marginTop: 12,
    paddingHorizontal: 32,
  },
});

export default PartnerAcceptScreen;









