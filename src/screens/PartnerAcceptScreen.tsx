import React, { useState, useEffect } from 'react';
import { API_BASE_URL as ENV_API_BASE_URL } from '../config/env';
import { BRAND_PRIMARY } from '../design/tokens';
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
import { ensureSupabaseJwt } from '../lib/supabase';
import { capture, AnalyticsEvents } from '../lib/analytics';
import { useOrg } from '../context/OrgContext';
import { createLogger } from '../utils/logger';
const log = createLogger('PartnerAcceptScreen');


const API_BASE_URL = ENV_API_BASE_URL;

interface RouteParams {
  inviteCode?: string;
  inviteId?: string;
  initialDetails?: {
    orgName?: string;
    productCount?: number;
    shareType?: string;
    locationName?: string;
  };
}

type AcceptStatus = 'loading' | 'ready' | 'accepting' | 'success' | 'error';

const PartnerAcceptScreen: React.FC = () => {
  const theme = useTheme();
  const route = useRoute();
  const navigation = useNavigation<any>();
  const { currentOrg } = useOrg();

  const { inviteCode } = (route.params as RouteParams) || {};

  const [status, setStatus] = useState<AcceptStatus>('loading');
  const [inviteDetails, setInviteDetails] = useState<{
    orgName?: string;
    locationName?: string;
    expiresAt?: string;
    productCount?: number;
    shareType?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    loadInviteDetails();
  }, [inviteCode]);

  const loadInviteDetails = async () => {
    if (!inviteCode) {
      setError('Invalid invite link');
      setStatus('error');
      return;
    }

    try {
      setStatus('loading');
      const token = await ensureSupabaseJwt();

      const response = await fetch(
        `${API_BASE_URL}/api/cross-org/invites/token/${encodeURIComponent(inviteCode)}`,
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
      setInviteDetails({
        orgName: data.sourceOrgName,
        locationName: data.sourcePoolName,
        expiresAt: data.expiresAt,
        productCount: data.productCount,
        shareType: data.shareType,
      });
      setStatus('ready');
    } catch (err: any) {
      log.error('[PartnerAcceptScreen] Error loading invite:', err);
      setError(err.message || 'Failed to load invite');
      setStatus('error');
    }
  };

  const handleAccept = async () => {
    if (!inviteCode || !currentOrg?.id) {
      setError('Choose an organization before accepting this invite.');
      setStatus('error');
      return;
    }
    try {
      setStatus('accepting');
      const token = await ensureSupabaseJwt();

      const response = await fetch(
        `${API_BASE_URL}/api/cross-org/invites/${encodeURIComponent(inviteCode)}/accept?orgId=${encodeURIComponent(currentOrg.id)}`,
        {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({}),
        }
      );

      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.message || 'Failed to accept invite');
      }

      capture(AnalyticsEvents.PARTNER_INVITE_ACCEPTED, { source: 'deep_link' });
      setStatus('success');

      // Navigate to Partners screen after success
      setTimeout(() => {
        navigation.navigate('Partners');
      }, 2000);
    } catch (err: any) {
      log.error('[PartnerAcceptScreen] Error accepting invite:', err);
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
          onPress: async () => {
            if (!inviteCode) return;
            try {
              const token = await ensureSupabaseJwt();
              const response = await fetch(
                `${API_BASE_URL}/api/cross-org/invites/${encodeURIComponent(inviteCode)}/decline`,
                { method: 'POST', headers: { Authorization: `Bearer ${token}` } },
              );
              if (!response.ok) throw new Error('Could not decline invite');
              navigation.goBack();
            } catch (error: any) {
              setError(error?.message || 'Could not decline invite');
              setStatus('error');
            }
          },
        },
      ]
    );
  };

  const renderContent = () => {
    if (status === 'loading') {
      return (
        <View style={styles.centerContent}>
          <ActivityIndicator size="large" color={theme.colors.primary} />
          <Text style={styles.loadingText}>Loading invite details...</Text>
        </View>
      );
    }

    if (status === 'success') {
      return (
        <View style={styles.centerContent}>
          <View style={styles.successIcon}>
            <Icon name="check-circle" size={48} color="#166534" />
          </View>
          <Text style={styles.title}>Partner Connected!</Text>
          <Text style={styles.description}>
            You are now sharing inventory with {inviteDetails?.orgName || 'your new partner'}.
          </Text>
        </View>
      );
    }

    if (status === 'error') {
      return (
        <View style={styles.centerContent}>
          <View style={styles.errorIcon}>
            <Icon name="alert-circle" size={48} color="#991B1B" />
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

    // Ready state
    return (
      <View style={styles.content}>
        <View style={styles.iconContainer}>
          <Icon name="storefront-check" size={40} color="#3F6212" />
        </View>

        <Text style={styles.title}>Connect Partner</Text>

        <View style={styles.inviteCard}>
          {inviteDetails?.orgName && (
            <View style={styles.detailRow}>
              <Icon name="domain" size={20} color={theme.colors.primary} />
              <Text style={styles.detailLabel}>Organization</Text>
              <Text style={styles.detailValue}>{inviteDetails.orgName}</Text>
            </View>
          )}

          {inviteDetails?.productCount !== undefined && inviteDetails.productCount > 0 && (
            <View style={styles.detailRow}>
              <Icon name="tshirt-crew" size={20} color={theme.colors.primary} />
              <Text style={styles.detailLabel}>Products to Sync</Text>
              <Text style={styles.detailValue}>{inviteDetails.productCount}</Text>
            </View>
          )}

          {inviteDetails?.shareType && (
            <View style={styles.detailRow}>
              <Icon name="handshake" size={20} color={theme.colors.primary} />
              <Text style={styles.detailLabel}>Type</Text>
              <Text style={[styles.detailValue, { textTransform: 'capitalize' }]}>{inviteDetails.shareType}</Text>
            </View>
          )}

        </View>

        <Text style={styles.description}>
          Accepting this invite will link your organizations and enable cross-org inventory syncing.
        </Text>

        <View style={styles.buttonGroup}>
          <Button
            title="Accept & Link"
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
      {renderContent()}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8F9FB',
  },
  content: {
    width: '90%',
    maxWidth: 400,
    alignItems: 'center',
    padding: 24,
  },
  centerContent: {
    alignItems: 'center',
    padding: 24,
  },
  iconContainer: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#ECFCCB', // Lime-100
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
    borderWidth: 1,
    borderColor: '#D9F99D',
  },
  successIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#DCFCE7', // Green-100
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  errorIcon: {
    width: 72,
    height: 72,
    borderRadius: 36,
    backgroundColor: '#FEE2E2', // Red-100
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: 24,
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    color: '#111827',
    textAlign: 'center',
    marginBottom: 12,
  },
  inviteCard: {
    backgroundColor: '#FFF',
    borderRadius: 16,
    padding: 20,
    width: '100%',
    marginBottom: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 2,
    borderWidth: 1,
    borderColor: '#E5E7EB',
  },
  detailRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F3F4F6',
    gap: 12,
  },
  detailLabel: {
    fontSize: 14,
    color: '#6B7280',
    fontWeight: '500',
  },
  detailValue: {
    fontSize: 14,
    color: '#111827',
    fontWeight: '600',
    flex: 1,
    textAlign: 'right',
  },
  description: {
    fontSize: 15,
    color: '#4B5563',
    textAlign: 'center',
    lineHeight: 22,
    marginBottom: 32,
    paddingHorizontal: 8,
  },
  loadingText: {
    fontSize: 16,
    color: '#4B5563',
    marginTop: 16,
  },
  buttonGroup: {
    width: '100%',
    gap: 12,
  },
  acceptButton: {
    backgroundColor: BRAND_PRIMARY,
  },
  declineButton: {
    borderColor: '#D1D5DB',
  },
  retryButton: {
    backgroundColor: BRAND_PRIMARY,
    marginTop: 24,
    paddingHorizontal: 32,
  },
  backButton: {
    borderColor: '#D1D5DB',
    marginTop: 12,
    paddingHorizontal: 32,
  },
});

export default PartnerAcceptScreen;
