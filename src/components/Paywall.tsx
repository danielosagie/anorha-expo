import React from 'react';
import { BRAND_PRIMARY } from '../design/tokens';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
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
  /** Pre-computed title for static rendering (e.g. Figma). When set, skips getTitle(). */
  title?: string;
  /** Pre-computed subtitle for static rendering (e.g. Figma). When set, skips getSubtitle(). */
  subtitle?: string;
}

const Paywall: React.FC<PaywallProps> = ({
  visible,
  onClose,
  onUpgrade,
  entitlements,
  feature,
  title: titleProp,
  subtitle: subtitleProp,
}) => {
  const theme = useTheme();
  const themeColors = theme?.colors ?? { text: '#333333', textSecondary: '#777777' };

  const ANORHA_GREEN = BRAND_PRIMARY;
  const WHITE_BG = '#FFFFFF';

  const getTitle = () => {
    if (!entitlements) return 'Start free trial';

    if (entitlements.subscriptionStatus === 'expired') {
      return 'Plan expired';
    }
    if (entitlements.subscriptionStatus === 'trialing' && entitlements.trialDaysLeft <= 3) {
      return 'Trial ending';
    }
    return 'Upgrade to continue';
  };

  const getSubtitle = () => {
    if (!entitlements) {
      return `${FREE_TRIAL_DAYS} days free.`;
    }

    if (entitlements.subscriptionStatus === 'trialing') {
      return `${entitlements.trialDaysLeft} day${entitlements.trialDaysLeft !== 1 ? 's' : ''} left.`;
    }

    if (entitlements.subscriptionStatus === 'expired') {
      return 'Restore sync and AI tools.';
    }

    return feature ? `Unlock ${feature}.` : 'Keep selling everywhere.';
  };

  const features = [
    { icon: 'sync', title: 'Live sync' },
    { icon: 'scan-helper', title: 'AI usage' },
    { icon: 'account-group', title: 'Team access' },
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

          <View style={styles.header}>
            <Text style={[styles.title, { color: themeColors.text }]}>{titleProp ?? getTitle()}</Text>
            <Text style={[styles.subtitle, { color: themeColors.textSecondary }]}>{subtitleProp ?? getSubtitle()}</Text>
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

          <View style={styles.featuresContainer}>
            {features.map((item, index) => (
              <View key={index} style={styles.featureRow}>
                <View style={[styles.featureIcon, { backgroundColor: ANORHA_GREEN + '15' }]}>
                  <Icon name={item.icon} size={20} color={ANORHA_GREEN} />
                </View>
                <Text style={[styles.featureTitle, { color: themeColors.text }]}>{item.title}</Text>
                <Icon name="check-circle" size={20} color={ANORHA_GREEN} />
              </View>
            ))}
          </View>

          {/* Pricing options */}
          <View style={styles.pricingContainer}>
            <TouchableOpacity
              style={[styles.pricingCard, styles.pricingCardSelected, { borderColor: ANORHA_GREEN }]}
              onPress={onUpgrade}
            >
              <View style={styles.pricingHeader}>
                <Text style={[styles.pricingName, { color: themeColors.text }]}>Growth</Text>
                <View style={[styles.popularBadge, { backgroundColor: ANORHA_GREEN }]}>
                  <Text style={styles.popularBadgeText}>POPULAR</Text>
                </View>
              </View>
              <Text style={[styles.pricingPrice, { color: themeColors.text }]}>$20<Text style={styles.pricingPeriod}>/month</Text></Text>
              <Text style={[styles.pricingFeatures, { color: themeColors.textSecondary }]}>
                Sync, scans, and 2 seats.
              </Text>
            </TouchableOpacity>
          </View>

          {/* CTA buttons */}
          <View style={styles.ctaContainer}>
            <Button
              title="Upgrade"
              onPress={onUpgrade}
              style={styles.upgradeButton}
            />
            <TouchableOpacity onPress={onClose} style={styles.maybeLaterButton}>
              <Text style={[styles.maybeLaterText, { color: themeColors.textSecondary }]}>Not now</Text>
            </TouchableOpacity>
          </View>

          {/* Footer note */}
          <Text style={[styles.footerNote, { color: themeColors.textSecondary }]}>
            Cancel anytime.
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
  featureTitle: {
    flex: 1,
    fontSize: 15,
    fontWeight: '600',
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
    backgroundColor: BRAND_PRIMARY,
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







