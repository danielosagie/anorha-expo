import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../../context/ThemeContext';

interface Member {
  Id: string;
  Role: 'admin' | 'member';
  User: {
    Email: string;
    FirstName?: string;
    LastName?: string;
  };
  platformAccess?: Array<{ id: string; name: string; type: string }>;
}

interface Props {
  member: Member;
  isCurrentUserAdmin: boolean;
  onPress?: () => void;
  onRemove?: () => void;
}

export default function MemberCard({ member, isCurrentUserAdmin, onPress, onRemove }: Props) {
  const theme = useTheme();

  const displayName = member.User.FirstName && member.User.LastName
    ? `${member.User.FirstName} ${member.User.LastName}`
    : member.User.Email;

  const initials = member.User.FirstName && member.User.LastName
    ? `${member.User.FirstName[0]}${member.User.LastName[0]}`.toUpperCase()
    : member.User.Email[0].toUpperCase();

  const roleColor = member.Role === 'admin' ? '#9b59b6' : '#3498db';
  const roleLabel = member.Role === 'admin' ? 'Admin' : 'Member';

  return (
    <TouchableOpacity
      style={styles.container}
      onPress={onPress}
      disabled={!onPress}
      activeOpacity={0.7}
    >
      <View style={styles.content}>
        {/* Avatar */}
        <View style={[styles.avatar, { backgroundColor: roleColor + '15', borderColor: roleColor + '30' }]}>
          <Text style={[styles.initials, { color: roleColor }]}>{initials}</Text>
        </View>

        {/* Info */}
        <View style={styles.info}>
          <Text style={styles.name}>{displayName}</Text>
          <Text style={styles.email}>{member.User.Email}</Text>

          <View style={styles.metadata}>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '10', borderColor: roleColor + '20', borderWidth: 1 }]}>
              <Icon
                name={member.Role === 'admin' ? 'crown' : 'account'}
                size={14}
                color={roleColor}
              />
              <Text style={[styles.roleText, { color: roleColor }]}>{roleLabel}</Text>
            </View>

            {member.platformAccess && member.platformAccess.length > 0 && (
              <View style={styles.platformsBadge}>
                <Icon name="link-variant" size={12} color="#666" />
                <Text style={styles.platformsText}>
                  {member.platformAccess.length} platform{member.platformAccess.length > 1 ? 's' : ''}
                </Text>
              </View>
            )}
          </View>
        </View>

        {/* Actions */}
        {isCurrentUserAdmin && onRemove && (
          <TouchableOpacity
            style={styles.removeButton}
            onPress={(e) => {
              e.stopPropagation();
              onRemove();
            }}
          >
            <Icon name="close-circle" size={24} color="#FF3B30" />
          </TouchableOpacity>
        )}

        {onPress && (
          <Icon name="chevron-right" size={20} color="#999" style={styles.chevron} />
        )}
      </View>
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  content: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 16,
    borderWidth: 1,
  },
  initials: {
    fontSize: 20,
    fontWeight: '700',
  },
  info: {
    flex: 1,
  },
  name: {
    fontSize: 17,
    fontWeight: '700',
    color: '#111827',
    marginBottom: 2,
  },
  email: {
    fontSize: 14,
    color: '#6B7280',
    marginBottom: 8,
  },
  metadata: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    gap: 4,
  },
  roleText: {
    fontSize: 12,
    fontWeight: '600',
  },
  platformsBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
  },
  platformsText: {
    fontSize: 11,
    color: '#666',
  },
  removeButton: {
    padding: 4,
    marginLeft: 8,
  },
  chevron: {
    marginLeft: 8,
  },
});

