import React from 'react';
import { View, Text, StyleSheet, TouchableOpacity } from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

interface Invitation {
  Id: string;
  Email: string;
  Role: 'admin' | 'member';
  CreatedAt: string;
  ExpiresAt: string;
}

interface Props {
  invitation: Invitation;
  onResend: () => void;
  onRevoke: () => void;
}

export default function PendingInvitationCard({ invitation, onResend, onRevoke }: Props) {
  const daysAgo = Math.floor(
    (Date.now() - new Date(invitation.CreatedAt).getTime()) / (1000 * 60 * 60 * 24)
  );

  const timeLabel = daysAgo === 0 ? 'Today' : daysAgo === 1 ? 'Yesterday' : `${daysAgo} days ago`;

  const roleColor = invitation.Role === 'admin' ? '#9b59b6' : '#3498db';

  return (
    <View style={styles.container}>
      <View style={styles.content}>
        <View style={styles.icon}>
          <Icon name="email-outline" size={24} color="#FF9500" />
        </View>

        <View style={styles.info}>
          <Text style={styles.email}>{invitation.Email}</Text>
          <View style={styles.metadata}>
            <View style={[styles.roleBadge, { backgroundColor: roleColor + '15' }]}>
              <Text style={[styles.roleText, { color: roleColor }]}>
                {invitation.Role === 'admin' ? 'Admin' : 'Member'}
              </Text>
            </View>
            <Text style={styles.time}>Sent {timeLabel}</Text>
          </View>
        </View>
      </View>

      <View style={styles.actions}>
        <TouchableOpacity style={styles.actionButton} onPress={onResend}>
          <Icon name="email-send" size={20} color="#5c9c00" />
          <Text style={[styles.actionText, { color: '#5c9c00' }]}>Resend</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.actionButton} onPress={onRevoke}>
          <Icon name="close" size={20} color="#FF3B30" />
          <Text style={[styles.actionText, { color: '#FF3B30' }]}>Revoke</Text>
        </TouchableOpacity>
      </View>
    </View>
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
    marginBottom: 8,
  },
  icon: {
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: '#FF9500' + '15',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 12,
  },
  info: {
    flex: 1,
  },
  email: {
    fontSize: 15,
    fontWeight: '500',
    marginBottom: 4,
  },
  metadata: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  roleBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 10,
  },
  roleText: {
    fontSize: 11,
    fontWeight: '600',
  },
  time: {
    fontSize: 12,
    color: '#666',
  },
  actions: {
    flexDirection: 'row',
    gap: 12,
    marginLeft: 60,
  },
  actionButton: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 6,
    backgroundColor: '#f5f5f5',
    gap: 4,
  },
  actionText: {
    fontSize: 13,
    fontWeight: '500',
  },
});

