import React, { useCallback, useState } from 'react';
import {
  Alert,
  FlatList,
  Pressable,
  RefreshControl,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import ActivityTraySheet from '../../features/liquidationConversation/components/activity/ActivityTraySheet';
import { useActivityTray } from '../../features/liquidationConversation/components/activity/useActivityTray';
import { CHAT_COLORS, CHAT_FONT } from '../../design/chatGlass';
import { useAgentReports, type AgentReportRecord } from '../../hooks/useAgentReports';
import ReportsAnalyticsHeader, { type ReportsSection } from './ReportsAnalyticsHeader';

const relativeDate = (iso: string): string => {
  const timestamp = Date.parse(iso);
  if (!Number.isFinite(timestamp)) return '';
  const elapsed = Math.max(0, Date.now() - timestamp);
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 1) return 'Now';
  if (minutes < 60) return `${minutes}m`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d`;
  return new Date(timestamp).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const ReportsTab: React.FC = () => {
  const { reports, loading, error, refetch, archiveReport } = useAgentReports();
  const [refreshing, setRefreshing] = useState(false);
  const [activeSection, setActiveSection] = useState<ReportsSection>('overview');
  const { openTray, trayProps } = useActivityTray();
  const showReports = activeSection === 'overview' || activeSection === 'reports';

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refetch().finally(() => setRefreshing(false));
  }, [refetch]);

  const openReport = useCallback((report: AgentReportRecord) => {
    openTray({
      kind: 'document',
      id: report.documentId || report.id,
      title: report.title,
      document: report.document,
    });
  }, [openTray]);

  const confirmArchive = useCallback((report: AgentReportRecord) => {
    Alert.alert(
      'Archive report?',
      `"${report.title}" will be removed from this list.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Archive',
          style: 'destructive',
          onPress: async () => {
            if (!(await archiveReport(report.id))) {
              Alert.alert('Could not archive report', 'Please try again.');
            }
          },
        },
      ],
    );
  }, [archiveReport]);

  const emptyState = !showReports || loading ? null : (
    <View style={styles.emptyState}>
      <Text style={styles.emptyText}>
        {error ? 'Reports could not load.' : 'No reports yet.'}
      </Text>
      {error ? (
        <Pressable onPress={onRefresh} disabled={refreshing} hitSlop={8} accessibilityRole="button">
          <Text style={styles.retryText}>{refreshing ? 'Trying again…' : 'Try again'}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  return (
    <View style={styles.screen}>
      <FlatList
        data={showReports ? reports : []}
        keyExtractor={(report) => report.id || report.documentId}
        contentContainerStyle={styles.content}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={CHAT_COLORS.brand}
          />
        }
        ListHeaderComponent={
          <ReportsAnalyticsHeader
            activeSection={activeSection}
            onSectionChange={setActiveSection}
            showReportsHeading={showReports}
          />
        }
        ListEmptyComponent={emptyState}
        ItemSeparatorComponent={() => <View style={styles.separator} />}
        renderItem={({ item }) => (
          <Pressable
            style={({ pressed }) => [styles.row, pressed ? styles.rowPressed : null]}
            onPress={() => openReport(item)}
            onLongPress={() => confirmArchive(item)}
            accessibilityRole="button"
            accessibilityLabel={`Open report ${item.title}`}
          >
            <View style={styles.leading}>
              <Icon name="file-document-outline" size={19} color={CHAT_COLORS.brandDeep} />
            </View>
            <View style={styles.reportCopy}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {item.summary || 'Open report'}
              </Text>
            </View>
            <Text style={styles.date}>{relativeDate(item.updatedAt)}</Text>
          </Pressable>
        )}
      />
      <ActivityTraySheet {...trayProps} />
    </View>
  );
};

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: CHAT_COLORS.white },
  content: { paddingHorizontal: 12, paddingTop: 8, paddingBottom: 140 },
  emptyState: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 18, paddingHorizontal: 4 },
  emptyText: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 13 },
  retryText: { color: CHAT_COLORS.inkSoft, fontFamily: CHAT_FONT.semibold, fontSize: 13 },
  separator: { height: 1, backgroundColor: CHAT_COLORS.divider, marginLeft: 52 },
  row: { flexDirection: 'row', alignItems: 'center', minHeight: 62, paddingVertical: 10, paddingHorizontal: 4, borderRadius: 12 },
  rowPressed: { backgroundColor: CHAT_COLORS.surface },
  leading: {
    width: 36,
    height: 36,
    borderRadius: 11,
    backgroundColor: CHAT_COLORS.brandSoft,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 11,
  },
  reportCopy: { flex: 1, minWidth: 0, marginRight: 10 },
  rowTitle: { color: CHAT_COLORS.ink, fontFamily: CHAT_FONT.semibold, fontSize: 14 },
  rowSub: { color: CHAT_COLORS.dim, fontFamily: CHAT_FONT.regular, fontSize: 12, marginTop: 3 },
  date: { color: CHAT_COLORS.faint, fontFamily: CHAT_FONT.regular, fontSize: 11.5, fontVariant: ['tabular-nums'] },
});

export default ReportsTab;
