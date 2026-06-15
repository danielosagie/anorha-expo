import React, { useCallback, useEffect, useState } from 'react';
import {
  View,
  Text,
  FlatList,
  StyleSheet,
  ActivityIndicator,
  RefreshControl,
  TouchableOpacity,
} from 'react-native';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';
import { API_BASE_URL } from '../../config/env';
import { ensureSupabaseJwt } from '../../lib/supabase';
import { useOrg } from '../../context/OrgContext';

// Orders tab — behaves like the activity feed (pulls /api/activity) but renders order events
// in a Shopify-orders row style: order title, date, a status pill, and the amount.

type OrderEvent = {
  id: string;
  timestamp: string;
  title: string;
  platformType?: string;
  status: string;
  amount?: number;
};

const INK = '#18181B';
const DIM = '#6B7280';
const FONT = { regular: 'Inter_400Regular', medium: 'Inter_500Medium', semibold: 'Inter_600SemiBold', bold: 'Inter_700Bold' };

const isOrderEvent = (eventType: string): boolean =>
  /order|sale|sold|purchase|checkout|refund/i.test(String(eventType || ''));

const pickAmount = (details: Record<string, any>): number | undefined => {
  for (const k of ['total', 'amount', 'orderTotal', 'totalPrice', 'price', 'grandTotal']) {
    const v = details?.[k];
    const n = typeof v === 'string' ? parseFloat(v) : v;
    if (typeof n === 'number' && isFinite(n)) return n;
  }
  return undefined;
};

const statusStyle = (status: string): { bg: string; fg: string; label: string } => {
  const s = String(status || '').toLowerCase();
  if (/paid|complete|fulfil|success|sold/.test(s)) return { bg: '#E7F6D7', fg: '#4E6B12', label: status || 'Paid' };
  if (/pend|process|open|unfulfil/.test(s)) return { bg: '#FBEAD2', fg: '#A2611A', label: status || 'Pending' };
  if (/refund|cancel|fail|void/.test(s)) return { bg: '#FEE2E2', fg: '#B91C1C', label: status || 'Refunded' };
  return { bg: '#F3F4F6', fg: '#4B5563', label: status || 'Order' };
};

const relativeDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) +
    ' · ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
};

const money = (n?: number) => (typeof n === 'number' && isFinite(n) ? `$${n.toFixed(2)}` : '—');

const OrdersTab: React.FC = () => {
  const { currentOrg } = useOrg();
  const [orders, setOrders] = useState<OrderEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try {
      const token = await ensureSupabaseJwt();
      if (!API_BASE_URL || !token) { setOrders([]); return; }
      const res = await fetch(`${API_BASE_URL}/api/activity?limit=100`, {
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      });
      if (!res.ok) { setOrders([]); return; }
      const data = await res.json();
      const events: any[] = Array.isArray(data?.events) ? data.events : [];
      const mapped: OrderEvent[] = events
        .filter((e) => isOrderEvent(e.EventType))
        .map((e) => ({
          id: String(e.Id),
          timestamp: e.Timestamp,
          title: e.Message || e.Details?.title || 'Order',
          platformType: e.PlatformType,
          status: e.Status || '',
          amount: pickAmount(e.Details || {}),
        }));
      setOrders(mapped);
    } catch {
      setOrders([]);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { load(); }, [load, currentOrg?.id]);

  const onRefresh = () => { setRefreshing(true); load(); };

  if (loading) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#93C822" />
      </View>
    );
  }

  if (orders.length === 0) {
    return (
      <View style={styles.center}>
        <Icon name="receipt-text-outline" size={44} color="#C7C7CC" />
        <Text style={styles.emptyTitle}>No orders yet</Text>
        <Text style={styles.emptySub}>Orders from your connected stores will appear here.</Text>
      </View>
    );
  }

  return (
    <FlatList
      data={orders}
      keyExtractor={(o) => o.id}
      contentContainerStyle={{ paddingHorizontal: 12, paddingTop: 8, paddingBottom: 140 }}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#93C822" />}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      renderItem={({ item }) => {
        const st = statusStyle(item.status);
        return (
          <TouchableOpacity style={styles.row} activeOpacity={0.7}>
            <View style={styles.leading}>
              <Icon name="receipt-text-outline" size={20} color={INK} />
            </View>
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle} numberOfLines={1}>{item.title}</Text>
              <Text style={styles.rowSub} numberOfLines={1}>
                {relativeDate(item.timestamp)}{item.platformType ? ` · ${item.platformType}` : ''}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 6 }}>
              <Text style={styles.amount}>{money(item.amount)}</Text>
              <View style={[styles.pill, { backgroundColor: st.bg }]}>
                <Text style={[styles.pillText, { color: st.fg }]} numberOfLines={1}>{st.label}</Text>
              </View>
            </View>
          </TouchableOpacity>
        );
      }}
    />
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
  amount: { fontSize: 15, fontFamily: FONT.bold, color: INK },
  pill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 999 },
  pillText: { fontSize: 11, fontFamily: FONT.semibold },
});

export default OrdersTab;
