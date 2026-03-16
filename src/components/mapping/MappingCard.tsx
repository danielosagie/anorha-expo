import React, { useMemo } from 'react';
import { View, Text, StyleSheet, TouchableOpacity, Image, AccessibilityRole } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import Animated, { FadeInUp, Layout } from 'react-native-reanimated';
import { tokens } from '../../design/tokens';
import Badge from '../ui/Badge';
import PlaceholderImage from '../PlaceholderImage';
import { Image as RNImage } from 'react-native';
// Local brand image fallback
// eslint-disable-next-line @typescript-eslint/no-var-requires
const brandImage = require('../../assets/rounded_anorha.png');

export type MappingVariant = 'new' | 'matched' | 'review' | 'ignored';

export type MappingCardProps = {
  variant: MappingVariant;
  isChild?: boolean;
  titleLeft: string;
  skuLeft?: string;
  priceLeft?: number;
  imageLeft?: string | null;
  variantCount?: number;
  priceRange?: string;

  titleRight?: string;
  skuRight?: string;
  priceRight?: number;
  imageRight?: string | null;

  attributesLeft?: { label: string, value: string | string[] }[];

  onSelect?: () => void;
  onIgnore?: () => void;
  onRestore?: () => void;
  onCreate?: () => void;
  onLink?: () => void;
  onSearch?: () => void;
  selected?: boolean;
  onApproveMatch?: () => void;
  isResolvedNew?: boolean;
  onEditNew?: () => void;
  onPress?: () => void;
};

const MappingCard: React.FC<MappingCardProps> = ({
  variant,
  titleLeft,
  skuLeft,
  priceLeft,
  imageLeft,
  titleRight,
  skuRight,
  priceRight,
  imageRight,
  onSelect,
  onIgnore,
  onRestore,
  onCreate,
  onLink,
  onSearch,
  selected,
  onApproveMatch,
  isResolvedNew = false,
  onEditNew,
  isChild = false,
  attributesLeft,
  variantCount,
  priceRange,
  onPress,
}) => {
  const actionBadge = useMemo(() => {
    if (variant === 'new') return <Badge variant="success">New</Badge>;
    if (variant === 'matched') return <Badge variant="success">Match</Badge>;
    return <Badge variant="warning">Review</Badge>;
  }, [variant]);


  return (
    <Animated.View entering={FadeInUp.duration(tokens.durations.fast)} layout={Layout.springify()} style={isChild ? { marginLeft: 20 } : null}>
      {isChild && (
        <View style={styles.nestingConnector} />
      )}
      <TouchableOpacity
        activeOpacity={onPress ? 0.7 : 1}
        onPress={onPress}
        style={[styles.card, selected ? styles.cardSelected : null]}
        accessibilityRole={"button" as AccessibilityRole}
      >
        {/* Content */}
        <View style={styles.row}>
          <View style={[styles.miniCard, styles.leftMini]}>
            {imageLeft ? (
              <Image source={{ uri: imageLeft }} style={styles.image} />
            ) : (
              <View style={styles.imagePlaceholder}>
                <Icon name={variantCount && variantCount > 1 ? "layers-outline" : "cube-outline"} size={22} color="#9CA3AF" />
              </View>
            )}
            <View style={styles.details}>
              <Text style={styles.title} numberOfLines={2}>{titleLeft}</Text>
              {/* Priority: 1) Expanded options (attributesLeft), 2) Variant count badge, 3) Single item SKU/price */}
              {attributesLeft && attributesLeft.length > 0 ? (
                <View style={styles.attributesContainer}>
                  {attributesLeft.map((attr, idx) => (
                    <View key={idx} style={styles.attributeGroup}>
                      <Text style={styles.attributeLabel}>{attr.label}</Text>
                      <View style={styles.pillRow}>
                        {(Array.isArray(attr.value) ? attr.value : [attr.value]).map((val, vIdx) => (
                          <Badge key={vIdx} variant="outline">
                            {val}
                          </Badge>
                        ))}
                      </View>
                    </View>
                  ))}
                  {priceRange ? <Text style={styles.price}>{priceRange}</Text> : null}
                </View>
              ) : variantCount != null && variantCount > 1 ? (
                <View style={styles.groupInfo}>
                  <Badge variant="outline">{variantCount} Variants</Badge>
                  {priceRange ? <Text style={styles.price}>{priceRange}</Text> : null}
                </View>
              ) : (
                <>
                  {!!skuLeft && <Text style={styles.subtle}>SKU: {skuLeft}</Text>}
                  {priceLeft != null && <Text style={styles.price}>${priceLeft.toFixed(2)}</Text>}
                </>
              )}
            </View>
          </View>

          <View style={styles.arrowWrap}>
            <Icon name="arrow-right-thin" size={24} color="#9CA3AF" />
          </View>

          <View style={[styles.miniCard, styles.rightMini, variant === 'matched' ? styles.rightLinked : variant === 'review' ? styles.rightNeedsReview : variant === 'ignored' ? styles.rightIgnored : styles.rightCreate]}>
            {(variant === 'new' || isResolvedNew) ? (
              <View style={styles.newRightCard} accessibilityLabel="New item">
                <Icon name="plus-circle" size={24} color="#fff" />
                <Text style={styles.newRightText}>New Item</Text>
              </View>
            ) : ((variant === 'matched' || (variant === 'review' && titleRight)) ? (
              <TouchableOpacity style={{ flex: 1, flexDirection: 'row', alignItems: 'center' }} onPress={onSearch} accessibilityLabel="Change match">
                <View style={styles.rightIconCircleImg}>
                  {imageRight ? (
                    <RNImage source={{ uri: imageRight as string }} style={{ width: 40, height: 40, borderRadius: 6 }} />
                  ) : (
                    <RNImage source={brandImage} style={{ width: 40, height: 40, borderRadius: 6 }} />
                  )}
                </View>
                <View style={styles.details}>
                  <Text style={styles.title} numberOfLines={2}>{titleRight}</Text>
                  {!!skuRight && <Text style={styles.subtle}>SKU: {skuRight}</Text>}
                  {priceRight != null && <Text style={styles.price}>${priceRight.toFixed(2)}</Text>}
                </View>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity onPress={onSearch} style={[styles.emptyRight, variant === 'review' ? styles.emptyRightReview : null]} accessibilityLabel="Link product">
                <View style={styles.emptyRightIconContainer}>
                  <Icon name={variant === 'review' ? 'magnify' : 'plus-circle-outline'} size={22} color={variant === 'review' ? '#D97706' : '#6B7280'} />
                </View>
                <Text style={[styles.emptyText, variant === 'review' ? styles.warningText : null]}>
                  {variant === 'review' ? 'Find Match' : 'Link Product'}
                </Text>
              </TouchableOpacity>
            ))}

          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {variant === 'ignored' ? (
            <TouchableOpacity
              style={[styles.actionBtn, styles.create, { flexDirection: 'row', alignItems: 'center' }]}
              onPress={onRestore}
              accessibilityLabel="Restore item"
            >
              <Icon name="restore" size={18} color="#93C822" style={{ marginRight: 6 }} />
              <Text style={styles.primaryText}>Restore Item</Text>
            </TouchableOpacity>
          ) : isResolvedNew ? (
            <>
              <View style={styles.actionsRow}>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.create, styles.actionWide, { flexDirection: 'row', alignItems: 'center' }]}
                  onPress={onEditNew}
                  accessibilityLabel="Edit new item"
                >
                  <Icon name="pencil" size={18} color={"#111"} style={{ marginRight: 6 }} />
                  <Text style={{ textAlign: 'center', color: '#111', fontWeight: '600' }}>Edit</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[styles.actionBtn, styles.ignore, styles.actionWide, { flexDirection: 'row', alignItems: 'center' }]}
                  onPress={onIgnore}
                  accessibilityLabel="Ignore item"
                >
                  <Icon name="close-box" size={18} color="#EF4444" style={{ marginRight: 6 }} />
                  <Text style={styles.dangerText}>Ignore Item</Text>
                </TouchableOpacity>
              </View>
            </>
          ) : (
            <>
              <View style={styles.actionsRow}>
                {variant !== 'matched' && !isResolvedNew && (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.create, styles.actionWide, { flexDirection: 'row', alignItems: 'center' }]}
                    onPress={onCreate}
                    accessibilityLabel="Create as new"
                  >
                    <Icon name="plus-box" size={18} color="#93C822" style={{ borderRadius: 6, marginRight: 6 }} />
                    <Text style={styles.primaryText}>Add as New Item</Text>
                  </TouchableOpacity>
                )}
                {variant === 'matched' || (variant === 'new' && isResolvedNew) ? (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.ignore, styles.actionWide, { flexDirection: 'row', alignItems: 'center' }]}
                    onPress={onIgnore}
                    accessibilityLabel="Remove mapping"
                  >
                    <Icon name="link-off" size={18} color="#EF4444" style={{ borderRadius: 6, marginRight: 6 }} />
                    <Text style={styles.dangerText}>Remove Mapping</Text>
                  </TouchableOpacity>
                ) : (
                  <TouchableOpacity
                    style={[styles.actionBtn, styles.ignore, styles.actionWide, { flexDirection: 'row', alignItems: 'center' }]}
                    onPress={onIgnore}
                    accessibilityLabel="Ignore item"
                  >
                    <Icon name="close-box" size={18} color="#EF4444" style={{ marginRight: 6 }} />
                    <Text style={styles.dangerText}>Ignore Item</Text>
                  </TouchableOpacity>
                )}
              </View>
              {variant === 'new' && isResolvedNew && (
                <View style={styles.actionsRow}>
                  <View style={styles.bannerNew}>
                    <Text style={styles.bannerNewText}>Adding As New Item</Text>
                  </View>
                </View>
              )}
              {variant === 'review' && !!titleRight && !isResolvedNew && (
                <View style={styles.actionsRow}>
                  <TouchableOpacity
                    style={[styles.actionPrimaryBtn, styles.create, styles.actionWide, { flexDirection: 'row', alignItems: 'center' }]}
                    onPress={onApproveMatch}
                    accessibilityLabel="Approve match"
                  >
                    <Icon name="check-circle-outline" size={18} color="rgb(94, 41, 11)" style={{ marginRight: 6 }} />
                    <Text style={[styles.primaryText, { color: 'rgb(94, 41, 11)' }]}>Approve Match</Text>
                  </TouchableOpacity>
                </View>
              )}
            </>
          )}
        </View>

        {/*
        <TouchableOpacity style={[styles.actionBtn, styles.confirm]} onPress={onLink} accessibilityLabel="Confirm link"><Icon name="check" size={18} color="#fff" /></TouchableOpacity>
        */}
      </TouchableOpacity>
    </Animated.View>
  );
};

export default React.memo(MappingCard);

const styles = StyleSheet.create({
  card: {
    backgroundColor: 'white',
    borderRadius: tokens.radii.lg,
    padding: tokens.spacing.md,
    marginBottom: tokens.spacing.lg,
    ...tokens.elevation(2),
    minHeight: 50,
  },
  cardSelected: {
    borderWidth: 1,
    borderColor: tokens.spacing.md ? '#D9D9D9' : '#D9D9D9', // Keep existing fallback
    shadowOpacity: 0.12,
    shadowRadius: 8,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: tokens.spacing.sm,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'stretch',
  },
  miniCard: {
    flex: 1,
    flexDirection: 'row',
    borderRadius: tokens.radii.md,
    padding: tokens.spacing.sm,
    backgroundColor: '#F9FAFB',
    alignItems: 'center',
    minHeight: 74,
  },
  leftMini: {},
  rightMini: {
    justifyContent: 'center',
  },
  rightLinked: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: '#BBF7D0',
  },
  rightNeedsReview: {
    borderWidth: 1,
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB',
  },
  rightCreate: {
    borderWidth: 1,
    borderColor: '#D9D9D9',
    backgroundColor: '#F3F4F6',
  },
  rightIgnored: {
    borderWidth: 1,
    borderColor: '#E5E7EB',
    backgroundColor: '#FAFAFA',
  },
  image: {
    width: 42,
    height: 42,
    borderRadius: tokens.radii.sm,
  },
  imagePlaceholder: {
    width: 42,
    height: 42,
    borderRadius: tokens.radii.sm,
    backgroundColor: '#F3F4F6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  details: {
    flex: 1,
    marginLeft: tokens.spacing.sm,
  },
  title: {
    fontWeight: '600',
    fontSize: tokens.fontSizes.md,
    color: '#111827',
  },
  subtle: {
    fontSize: tokens.fontSizes.sm,
    color: '#6B7280',
    marginTop: 2,
  },
  price: {
    fontSize: tokens.fontSizes.sm,
    color: '#5C9B00',
    fontWeight: '700',
    marginTop: 2,
  },
  arrowWrap: {
    paddingHorizontal: tokens.spacing.sm,
    justifyContent: 'center',
  },
  rightIconCircle: {
    width: 28,
    height: 28,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#22C55E',
    marginRight: tokens.spacing.sm,
  },
  rightIconCircleImg: {
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: tokens.spacing.sm,
  },
  newPill: {
    position: 'absolute',
    bottom: 6,
    left: 6,
    right: 6,
    backgroundColor: '#93C822',
    borderRadius: 10,
    paddingVertical: 6,
    alignItems: 'center',
  },
  newPillText: { color: '#fff', fontWeight: '800' },
  emptyRight: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: tokens.spacing.md,
    borderRadius: tokens.radii.md,
    borderWidth: 2,
    borderColor: '#D9D9D9',
    borderStyle: 'dashed',
    backgroundColor: '#F9FAFB',
  },
  emptyText: {
    marginTop: 4,
    fontWeight: '600',
    color: '#6B7280',
  },
  warningText: {
    color: '#D97706',
  },
  actions: {
    flexDirection: 'column',
    borderTopWidth: 1,
    borderTopColor: '#F3F4F6',
    marginTop: tokens.spacing.md,
    paddingTop: tokens.spacing.sm,
  },
  actionsRow: {
    flexDirection: 'row',
    gap: 12,
    marginBottom: 10,
  },
  actionBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    gap: 3,
    backgroundColor: '#FFFFFF',
    borderColor: '#E4E4E7',
    alignContent: 'center',
    justifyContent: 'center',
    fontWeight: '500',
  },
  actionPrimaryBtn: {
    flex: 1,
    height: 44,
    borderRadius: 12,
    borderWidth: 2,
    gap: 3,
    backgroundColor: 'rgba(255, 188, 19, 0.4)',
    borderColor: 'rgba(135, 142, 62, 0.6)',
    borderStyle: 'dashed',
    alignContent: 'center',
    justifyContent: 'center',
    fontWeight: '500',
  },
  create: {},
  ignore: {},
  actionWide: { flex: 1 },
  search: { backgroundColor: '#5C9B00' },
  primaryText: { textAlign: 'center', color: '#93C822', fontWeight: '600' },
  dangerText: { textAlign: 'center', color: '#EF4444', fontWeight: '600' },
  bannerNew: {
    backgroundColor: '#93C822',
    borderRadius: 10,
    paddingVertical: 12,
    paddingHorizontal: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
  },
  bannerNewText: { color: '#FFF', fontWeight: '800' },
  newRightCard: {
    flex: 1,
    minHeight: 70,
    borderRadius: 8,
    backgroundColor: '#93C822',
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  newRightText: {
    color: '#fff',
    fontWeight: '700',
    marginLeft: 8,
  },
  nestingConnector: {
    position: 'absolute',
    left: -12,
    top: -24,
    bottom: '50%',
    width: 2,
    backgroundColor: '#E5E7EB',
    borderBottomLeftRadius: 8,
    borderLeftWidth: 0,
    borderBottomWidth: 2,
    borderColor: '#E5E7EB',
  },
  emptyRightReview: {
    borderColor: '#FCD34D',
    backgroundColor: '#FFFBEB',
  },
  emptyRightIconContainer: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: 'rgba(255, 255, 255, 0.8)',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
    ...tokens.elevation(1),
  },
  attributesContainer: {
    marginTop: 8,
    gap: 6,
  },
  attributeGroup: {
    marginBottom: 4,
  },
  attributeLabel: {
    fontSize: 10,
    fontWeight: '700',
    color: '#9CA3AF',
    textTransform: 'uppercase',
    marginBottom: 4,
  },
  pillRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 4,
  },
  groupInfo: {
    flexDirection: 'column',
    alignItems: 'flex-start',
    gap: 8,
    marginTop: 4,
  },
});


