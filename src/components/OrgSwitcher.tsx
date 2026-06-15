import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Modal,
  TouchableOpacity,
  ScrollView,
  ActivityIndicator,
  TextInput,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useTheme } from '../context/ThemeContext';
import { supabase, ensureSupabaseJwt } from '../lib/supabase';
import { API_BASE_URL as ENV_API_BASE_URL } from '../config/env';
import { showMessage } from 'react-native-flash-message';
import Button from './Button';
import Card from './Card';
import { createLogger } from '../utils/logger';
const log = createLogger('OrgSwitcher');


const API_BASE_URL = ENV_API_BASE_URL;

interface Organization {
  Id: string;
  Name: string;
  Role?: 'org:admin' | 'org:member';
}

interface OrgSwitcherProps {
  currentOrgId?: string;
  onOrgChanged?: (orgId: string, orgName: string) => void;
}

export default function OrgSwitcher({ currentOrgId, onOrgChanged }: OrgSwitcherProps) {
  const theme = useTheme();
  
  const [isDropdownVisible, setIsDropdownVisible] = useState(false);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(false);
  const [currentOrg, setCurrentOrg] = useState<Organization | null>(null);
  const [isCreateModalVisible, setIsCreateModalVisible] = useState(false);
  const [newOrgName, setNewOrgName] = useState('');
  const [isCreatingOrg, setIsCreatingOrg] = useState(false);

  useEffect(() => {
    loadOrganizations();
  }, []);

  const loadOrganizations = async () => {
    try {
      setLoading(true);
      const token = await ensureSupabaseJwt();
      if (!token) return;

      // Fetch all user organizations
      const response = await fetch(`${API_BASE_URL}/api/organizations`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        log.error('[OrgSwitcher] Failed to load orgs, status:', response.status);
        throw new Error('Failed to load orgs');
      }

      const data = await response.json();
      const orgs: Organization[] = data.map((item: any) => ({
        Id: item.Organizations.Id,
        Name: item.Organizations.Name,
        Role: item.Role,
      }));

      setOrganizations(orgs);
      log.debug('[OrgSwitcher] Loaded organizations:', orgs.length);

      // Fetch active organization
      const activeResponse = await fetch(`${API_BASE_URL}/api/organizations/me/active`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (activeResponse.ok) {
        const activeData = await activeResponse.json();
        log.debug('[OrgSwitcher] Active org response:', activeData);
        // The backend returns { orgId }, find the matching org
        const activeOrg = orgs.find(org => org.Id === activeData.orgId);
        if (activeOrg) {
          setCurrentOrg(activeOrg);
          log.debug('[OrgSwitcher] Set current org to:', activeOrg.Name);
        } else if (orgs.length > 0) {
          setCurrentOrg(orgs[0]);
          log.debug('[OrgSwitcher] No active org matched, defaulted to first:', orgs[0].Name);
        }
      } else if (orgs.length > 0) {
        setCurrentOrg(orgs[0]);
        log.debug('[OrgSwitcher] Failed to get active org, defaulted to first:', orgs[0].Name);
      }
    } catch (error) {
      log.error('[OrgSwitcher] Error loading orgs:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleSwitchOrg = async (org: Organization) => {
    try {
      const token = await ensureSupabaseJwt();
      if (!token) return;

      const response = await fetch(
        `${API_BASE_URL}/api/organizations/user/active-org/${org.Id}`,
        {
          method: 'PATCH',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      if (!response.ok) throw new Error('Failed to switch org');

      setCurrentOrg(org);
      setIsDropdownVisible(false);
      
      showMessage({
        message: 'Success',
        description: `Switched to ${org.Name}`,
        type: 'success',
      });

      onOrgChanged?.(org.Id, org.Name);
    } catch (error) {
      log.error('[OrgSwitcher] Error switching org:', error);
      showMessage({
        message: 'Error',
        description: 'Failed to switch organization',
        type: 'danger',
      });
    }
  };

  const handleCreateOrg = async () => {
    if (!newOrgName.trim()) {
      showMessage({
        message: 'Error',
        description: 'Organization name is required',
        type: 'warning',
      });
      return;
    }

    try {
      setIsCreatingOrg(true);
      const token = await ensureSupabaseJwt();
      if (!token) return;

      const response = await fetch(`${API_BASE_URL}/api/organizations`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: newOrgName }),
      });

      if (!response.ok) throw new Error('Failed to create org');

      showMessage({
        message: 'Success',
        description: `${newOrgName} created!`,
        type: 'success',
      });

      setNewOrgName('');
      setIsCreateModalVisible(false);
      await loadOrganizations();
    } catch (error) {
      log.error('[OrgSwitcher] Error creating org:', error);
      showMessage({
        message: 'Error',
        description: 'Failed to create organization',
        type: 'danger',
      });
    } finally {
      setIsCreatingOrg(false);
    }
  };

  if (!currentOrg) {
    return <ActivityIndicator color={theme.colors.primary} />;
  }

  return (
    <>
      <TouchableOpacity
        style={[
          styles.triggerButton,
          { 
            backgroundColor: theme.colors.background,
            borderColor: '#e0e0e0',
          },
        ]}
        onPress={() => setIsDropdownVisible(true)}
      >
        <View style={styles.triggerContent}>
          <Icon name="briefcase" size={18} color={theme.colors.primary} />
          <Text style={[styles.triggerText, { color: theme.colors.text }]} numberOfLines={1}>
            {currentOrg.Name}
          </Text>
        </View>
        <Icon name="chevron-down" size={20} color={theme.colors.primary} />
      </TouchableOpacity>

      <Modal
        visible={isDropdownVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsDropdownVisible(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setIsDropdownVisible(false)}
        >
          <Card style={styles.dropdownCard}>
            <View style={styles.dropdownHeader}>
              <Text style={[styles.dropdownTitle, { color: theme.colors.text }]}>
                My Organizations
              </Text>
              <TouchableOpacity onPress={() => setIsDropdownVisible(false)}>
                <Icon name="close" size={24} color={theme.colors.text} />
              </TouchableOpacity>
            </View>

            <ScrollView style={styles.orgsScrollView}>
              {organizations.map((org) => (
                <TouchableOpacity
                  key={org.Id}
                  style={[
                    styles.orgItem,
                    currentOrg.Id === org.Id && {
                      backgroundColor: theme.colors.primary + '10',
                    },
                  ]}
                  onPress={() => handleSwitchOrg(org)}
                >
                  <View style={styles.orgItemContent}>
                    <Icon
                      name={currentOrg.Id === org.Id ? 'briefcase' : 'briefcase-outline'}
                      size={20}
                      color={currentOrg.Id === org.Id ? theme.colors.primary : theme.colors.textSecondary}
                    />
                    <View style={styles.orgItemText}>
                      <Text style={[styles.orgItemName, { color: currentOrg.Id === org.Id ? theme.colors.primary : theme.colors.text }]}>
                        {org.Name}
                      </Text>
                      <Text style={[styles.orgItemRole, { color: theme.colors.textSecondary }]}>
                        {org.Role === 'org:admin' ? 'Admin' : 'Member'}
                      </Text>
                    </View>
                  </View>
                  {currentOrg.Id === org.Id && (
                    <Icon name="check-circle" size={20} color={theme.colors.primary} />
                  )}
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.dropdownDivider} />

            <TouchableOpacity
              style={styles.createOrgButton}
              onPress={() => {
                setIsDropdownVisible(false);
                setIsCreateModalVisible(true);
              }}
            >
              <Icon name="plus-circle-outline" size={20} color={theme.colors.primary} />
              <Text style={[styles.createOrgText, { color: theme.colors.primary }]}>
                Create New Organization
              </Text>
            </TouchableOpacity>
          </Card>
        </TouchableOpacity>
      </Modal>

      <Modal
        visible={isCreateModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setIsCreateModalVisible(false)}
      >
        <TouchableOpacity
          style={styles.overlay}
          activeOpacity={1}
          onPress={() => setIsCreateModalVisible(false)}
        >
          <TouchableOpacity
            activeOpacity={1}
            style={styles.createOrgModal}
            onPress={() => {}}
          >
            <Card>
              <Text style={[styles.modalTitle, { color: theme.colors.text }]}>
                Create New Organization
              </Text>
              
              <TextInput
                style={[
                  styles.textInput,
                  {
                    borderColor: theme.colors.border || '#e0e0e0',
                    color: theme.colors.text,
                  },
                ]}
                placeholder="Organization name"
                placeholderTextColor={theme.colors.textSecondary}
                value={newOrgName}
                onChangeText={setNewOrgName}
                editable={!isCreatingOrg}
              />

              <View style={styles.modalActions}>
                <Button
                  title="Cancel"
                  outlined
                  onPress={() => {
                    setIsCreateModalVisible(false);
                    setNewOrgName('');
                  }}
                  disabled={isCreatingOrg}
                  style={styles.modalButton}
                />
                <Button
                  title="Create"
                  onPress={handleCreateOrg}
                  loading={isCreatingOrg}
                  style={styles.modalButton}
                />
              </View>
            </Card>
          </TouchableOpacity>
        </TouchableOpacity>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  triggerButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 8,
    borderWidth: 1,
    marginBottom: 16,
  },
  triggerContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 8,
  },
  triggerText: {
    fontSize: 14,
    fontWeight: '600',
    flex: 1,
  },
  overlay: {
    flex: 1,
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
    justifyContent: 'flex-start',
    paddingHorizontal: 16,
    paddingTop: 20,
  },
  dropdownCard: {
    maxHeight: 400,
  },
  dropdownHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  dropdownTitle: {
    fontSize: 16,
    fontWeight: 'bold',
  },
  orgsScrollView: {
    maxHeight: 300,
  },
  orgItem: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderRadius: 8,
    marginBottom: 8,
  },
  orgItemContent: {
    flexDirection: 'row',
    alignItems: 'center',
    flex: 1,
    gap: 12,
  },
  orgItemText: {
    flex: 1,
  },
  orgItemName: {
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 2,
  },
  orgItemRole: {
    fontSize: 12,
  },
  dropdownDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
  },
  createOrgButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    gap: 8,
  },
  createOrgText: {
    fontSize: 14,
    fontWeight: '600',
  },
  createOrgModal: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 16,
  },
  modalTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    marginBottom: 16,
  },
  textInput: {
    borderWidth: 1,
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 14,
    marginBottom: 16,
  },
  modalActions: {
    flexDirection: 'row',
    gap: 12,
    justifyContent: 'flex-end',
  },
  modalButton: {
    flex: 1,
  },
});