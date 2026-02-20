import React from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  Image,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import Button from './Button';
import { UserEntitlements, FREE_TRIAL_DAYS } from '../utils/entitlements';

interface PaywallProps {
  visible: boolean;
  onClose: () => void;
  onUpgrade: () => void;
  entitlements: UserEntitlements | null;
  feature?: string; // Optional feature name being gated
}

const Paywall: React.FC<PaywallProps> = ({
  visible,
  onClose,
  onUpgrade,
  entitlements,
  feature,
}) => {
  const theme = useTheme();

  const ANORHA_GREEN = '#93C822';
  const WHITE_BG = '#FFFFFF';

  const getTitle = () => {
    if (!entitlements) return 'Start Your Free Trial';

    if (entitlements.subscriptionStatus === 'expired') {
      return 'Your Subscription Has Expired';
    }
    if (entitlements.subscriptionStatus === 'trialing' && entitlements.trialDaysLeft <= 3) {
      return 'Your Trial is Ending Soon';
    }
    return 'Upgrade to Access This Feature';
  };

  const getSubtitle = () => {
    if (!entitlements) {
      return `Start your ${FREE_TRIAL_DAYS}-day free trial to unlock all features.`;
    }

    if (entitlements.subscriptionStatus === 'trialing') {
      return `You have ${entitlements.trialDaysLeft} day${entitlements.trialDaysLeft !== 1 ? 's' : ''} left in your trial. Upgrade now to continue using all features.`;
    }

    if (entitlements.subscriptionStatus === 'expired') {
      return 'Reactivate your subscription to continue syncing inventory across platforms.';
    }

    return feature
      ? `Upgrade your plan to access ${feature}.`
      : 'Upgrade to unlock premium features.';
  };

  const features = [
    { icon: 'sync', title: 'Real-time Sync', description: 'Keep inventory synced across all platforms' },
    { icon: 'scan-helper', title: 'AI Product Scanning', description: 'Scan and list products with AI' },
    { icon: 'account-group', title: 'Team Collaboration', description: 'Invite team members and partners' },
    { icon: 'chart-line', title: 'Analytics & Insights', description: 'Track inventory trends and performance' },
  ];

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent={true}
      onRequestClose={onClose}
    >
      <View style={styles.overlay}>
        <View style={[styles.container, { backgroundColor: WHITE_BG }]}>
          {/* Close button */}
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <View style={styles.closeButtonInner}>
              <Icon name="close" size={20} color="#999" />
            </View>
          </TouchableOpacity>

          {/* Header */}
          <View style={styles.header}>
            <Image source={require('../assets/anorha_logo.png')} style={{ width: 140, height: 40, resizeMode: 'contain', marginBottom: 16 }} />
            <Text style={[styles.title, { color: theme.colors.text }]}>{getTitle()}</Text>
            <Text style={[styles.subtitle, { color: theme.colors.textSecondary }]}>{getSubtitle()}</Text>
          </View>

          {/* Trial badge */}
          {entitlements?.subscriptionStatus === 'trialing' && (
            <View style={[styles.trialBadge, { backgroundColor: '#FFF3CD', borderColor: '#FFD93D' }]}>
              <Icon name="clock-outline" size={18} color="#856404" />
              <Text style={styles.trialBadgeText}>
                {entitlements.trialDaysLeft} day{entitlements.trialDaysLeft !== 1 ? 's' : ''} remaining in trial
              </Text>
            </View>
          )}

          {/* Features list */}
          <ScrollView style={styles.featuresContainer} showsVerticalScrollIndicator={false}>
            {features.map((item, index) => (
              <View key={index} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: ANORHA_GREEN + '15' }]}>
                  <Icon name={item.icon} size={20} color={ANORHA_GREEN} />
                </View>
                <View style={styles.featureText}>
                  <Text style={[styles.featureTitle, { color: theme.colors.text }]}>{item.title}</Text>
                  <Text style={[styles.featureDescription, { color: theme.colors.textSecondary }]}>
                    {item.description}
                  </Text>
                </View>
                <Icon name="check-circle" size={20} color={ANORHA_GREEN} />
              </View>
            ))}
          </ScrollView>

          {/* Pricing options */}
          <View style={styles.pricingContainer}>
            <TouchableOpacity
              style={[styles.pricingCard, styles.pricingCardSelected, { borderColor: ANORHA_GREEN }]}
              onPress={onUpgrade}
            >
              <View style={styles.pricingHeader}>
                <Text style={[styles.pricingName, { color: theme.colors.text }]}>Growth</Text>
                <View style={[styles.popularBadge, { backgroundColor: ANORHA_GREEN }]}>
                  <Text style={styles.popularBadgeText}>POPULAR</Text>
                </View>
              </View>
              <Text style={[styles.pricingPrice, { color: theme.colors.text }]}>$20<Text style={styles.pricingPeriod}>/month</Text></Text>
              <Text style={[styles.pricingFeatures, { color: theme.colors.textSecondary }]}>
                2 platforms • 40 AI scans/mo • 2 team members
              </Text>
            </TouchableOpacity>
          </View>

          {/* CTA buttons */}
          <View style={styles.ctaContainer}>
            <Button
              title="Upgrade Now"
              onPress={onUpgrade}
              style={styles.upgradeButton}
            />
            <TouchableOpacity onPress={onClose} style={styles.maybeLaterButton}>
              <Text style={[styles.maybeLaterText, { color: theme.colors.textSecondary }]}>Maybe Later</Text>
            </TouchableOpacity>
          </View>

          {/* Footer note */}
          <Text style={[styles.footerNote, { color: theme.colors.textSecondary }]}>
            Cancel anytime. Secure payment via Polar.
          </Text>
        </View>
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-end',
  },
  container: {
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 34,
    maxHeight: '90%',
  },
  closeButton: {
    position: 'absolute',
    top: 16,
    right: 16,
    zIndex: 10,
  },
  closeButtonInner: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: '#F2F2F7',
    alignItems: 'center',
    justifyContent: 'center',
  },
  header: {
    alignItems: 'center',
    marginTop: 20,
    marginBottom: 16,
  },
  iconContainer: {
    width: 80,
    height: 80,
    borderRadius: 40,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    textAlign: 'center',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 14,
    textAlign: 'center',
    paddingHorizontal: 20,
    lineHeight: 20,
  },
  trialBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
    gap: 8,
  },
  trialBadgeText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#856404',
  },
  featuresContainer: {
    maxHeight: 200,
    marginBottom: 16,
  },
  featureRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    gap: 12,
  },
  featureIcon: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  featureText: {
    flex: 1,
  },
  featureTitle: {
    fontSize: 15,
    fontWeight: '600',
    marginBottom: 2,
  },
  featureDescription: {
    fontSize: 13,
  },
  pricingContainer: {
    paddingTop: 16,
    marginBottom: 16,
  },
  pricingCard: {
    borderWidth: 2,
    borderColor: '#E0E0E0',
    borderRadius: 12,
    padding: 16,
  },
  pricingCardSelected: {
    borderWidth: 2,
  },
  pricingHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  pricingName: {
    fontSize: 18,
    fontWeight: '700',
  },
  popularBadge: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 4,
  },
  popularBadgeText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '700',
  },
  pricingPrice: {
    fontSize: 28,
    fontWeight: '700',
    marginBottom: 4,
  },
  pricingPeriod: {
    fontSize: 14,
    fontWeight: '400',
  },
  pricingFeatures: {
    fontSize: 13,
  },
  ctaContainer: {
    gap: 12,
  },
  upgradeButton: {
    backgroundColor: '#93C822',
  },
  maybeLaterButton: {
    alignItems: 'center',
    paddingVertical: 12,
  },
  maybeLaterText: {
    fontSize: 14,
    fontWeight: '500',
  },
  footerNote: {
    fontSize: 12,
    textAlign: 'center',
    marginTop: 12,
  },
});

export default Paywall;










