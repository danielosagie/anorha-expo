import React, { useCallback } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
  Alert,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { useAgentReports, type AgentReportRecord } from '../../hooks/useAgentReports';
import ActivityTraySheet from '../../features/liquidationConversation/components/activity/ActivityTraySheet';
import { useActivityTray } from '../../features/liquidationConversation/components/activity/useActivityTray';

// Reports tab — every report Sprout has authored (chat reports, home insights,
// campaign wrap-ups), org-wide. Tapping a row opens the same report bottom
// sheet the chat uses, so a report is reviewable from anywhere, not only from
// the message that carried it.

const INK = '#18181B';
const DIM = '#6B7280';
const FONT = { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' };

const SOURCE_META: Record<AgentReportRecord['source'], { label: string; icon: string; bg: string; fg: string }> = {
  chat: { label: 'Chat', icon: 'chat-outline', bg: '#E7F6D7', fg: '#4E6B12' },
  insight: { label: 'Insight', icon: 'lightbulb-on-outline', bg: '#FBEAD2', fg: '#A2611A' },
  digest: { label: 'Wrap-up', icon: 'flag-checkered', bg: '#E0E7FF', fg: '#3730A3' },
  system: { label: 'System', icon: 'cog-outline', bg: '#F3F4F6', fg: '#4B5563' },
};

const relativeDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const ReportsTab: React.FC = () => {
  const { reports, loading, error, refetch, archiveReport } = useAgentReports();
  const [refreshing, setRefreshing] = React.useState(false);
  const { openTray, trayProps } = useActivityTray();

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
        { text: 'Archive', style: 'destructive', onPress: () => { archiveReport(report.id); } },
      ],
    );
  }, [archiveReport]);

  if (loading && reports.length === 0) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#93C822" />
      </View>
    );
  }

  if (reports.length === 0) {
    return (
      <View style={styles.center}>
        <Icon name="file-document-outline" size={44} color="#C7C7CC" />
        <Text style={styles.emptyTitle}>No reports yet</Text>
        <Text style={styles.emptySub}>
          {error
            ? 'Reports could not load. Pull to retry.'
            : 'Ask Sprout to audit your inventory or research the market, and the reports land here.'}
        </Text>
      </View>
    );
  }

  return (
    <View style={{ flex: 1 }}>
      <FlatList
        data={reports}
        keyExtractor={(r) => r.id || r.documentId}
        contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 140 }}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#93C822" />}
        ItemSeparatorComponent={() => <View style={styles.sep} />}
        renderItem={({ item }) => {
          const meta = SOURCE_META[item.source] || SOURCE_META.chat;
          return (
            <TouchableOpacity
              style={styles.row}
              activeOpacity={0.7}
              onPress={() => openReport(item)}
              onLongPress={() => confirmArchive(item)}
            >
              <View style={styles.leading}>
                <Icon name="file-document-outline" size={20} color={INK} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
                <Text style={styles.rowSub} numberOfLines={2}>
                  {item.summary || relativeDate(item.updatedAt)}
                </Text>
              </View>
              <View style={{ alignItems: 'flex-end', gap: 6 }}>
                <Text style={styles.date}>{relativeDate(item.updatedAt)}</Text>
                <View style={[styles.pill, { backgroundColor: meta.bg }]}>
                  <Text style={[styles.pillText, { color: meta.fg }]} numberOfLines={1}>{meta.label}</Text>
                </View>
              </View>
            </TouchableOpacity>
          );
        }}
      />
      <ActivityTraySheet {...trayProps} />
    </View>
  );
};

const styles = StyleSheet.create({
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24, gap: 8 },
  emptyTitle: { fontSize: 17, fontFamily: FONT.semibold, color: INK, marginTop: 6 },
  emptySub: { fontSize: 13, fontFamily: FONT.regular, color: DIM, textAlign: 'center' },
  sep: { height: 1, backgroundColor: '#F1F2F4', marginLeft: 60 },
  row: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14, paddingHorizontal: 4 },
  leading: {
    width: 40, height: 40, borderRadius: 12, backgroundColor: '#F4F4F1',
    alignItems: 'center', justifyContent: 'center', marginRight: 12,
  },
  rowTitle: { fontSize: 15, fontFamily: FONT.semibold, color: INK },
  rowSub: { fontSize: 12.5, fontFamily: FONT.regular, color: DIM, marginTop: 2 },
  date: { fontSize: 12, fontFamily: FONT.medium, color: DIM },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontFamily: FONT.semibold },
});

export default ReportsTab;
