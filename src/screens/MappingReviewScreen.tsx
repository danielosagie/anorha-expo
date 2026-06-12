import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  ScrollView,
  FlatList,
  Pressable,
  TextInput,
  Modal,
  Image,
  Platform,
  Alert,
  KeyboardAvoidingView,
} from 'react-native';
import { RouteProp, useNavigation, useRoute } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import Icon from 'react-native-vector-icons/MaterialCommunityIcons';

import { AppStackParamList } from '../navigation/AppNavigator';
import { useImportSession } from '../hooks/useImportSession';
import { ImportWizardSheet } from '../components/import/ImportWizardSheet';
import { usePlatformConnections } from '../context/PlatformConnectionsContext';
import { MappingSuggestion } from '../types/importSession';
import {
  QUEST,
  QFONT,
  QuestBar,
  QuestRow,
  QuestCTA,
  LessonShell,
  QuestDone,
  QuestSegment,
} from '../components/quest/QuestKit';
import {
  LobbyHeader,
  HeaderIconGroup,
  IssueLane,
  LaneIssue,
  IconName,
  InventoryRow,
  InventoryItemData,
} from '../components/quest/LobbyKit';
import BottomActionBar from '../components/BottomActionBar';
import { RC, MiniProgress } from '../components/resolve/ResolveKit';
import { MatchResolver, MatchCase, Decision, ResolveMeta, CandidateItem } from '../components/resolve/matchResolvers';
import { classifyMatch, applyMatchDecision } from '../components/resolve/classifyMatch';

// ---------------------------------------------------------------------------
// Classification — collapse the old 5 reason buckets into 4 quests (HO4).
//   no_match_found            → "New to your catalog"
//   low_confidence/duplicate/stale_match → "Confirm fuzzy matches"
//   variant_mismatch          → "Resolve variants"
//   (auto-matched)            → informational "Auto-matched" done quest
// ---------------------------------------------------------------------------

type ReviewReason = 'no_match_found' | 'low_confidence' | 'duplicate' | 'variant_mismatch' | 'stale_match';

interface AnnotatedSuggestion extends MappingSuggestion {
  reviewReason?: ReviewReason;
  isStaleClaim: boolean;
}

function annotateSuggestions(suggestions: MappingSuggestion[]): AnnotatedSuggestion[] {
  const claimedIds = new Set<string>();
  suggestions.forEach((s) => {
    if (s.action === 'LINK_EXISTING' && s.resolved && s.suggestedCanonicalProduct?.id) {
      claimedIds.add(s.suggestedCanonicalProduct.id);
    }
  });

  const familyResolvedCanonicalIds = new Map<string, Set<string>>();
  suggestions.forEach((item) => {
    const parentId = item.platformProduct.parentId;
    const canonicalId = item.suggestedCanonicalProduct?.id || null;
    if (!parentId || !canonicalId || item.resolved !== true || item.action !== 'LINK_EXISTING') return;
    if (!familyResolvedCanonicalIds.has(parentId)) {
      familyResolvedCanonicalIds.set(parentId, new Set<string>());
    }
    familyResolvedCanonicalIds.get(parentId)!.add(canonicalId);
  });

  return suggestions.map((item) => {
    const unresolved = item.action !== 'IGNORE' && item.resolved !== true;
    const canonicalId = item.suggestedCanonicalProduct?.id || null;
    const familyResolvedIds = item.platformProduct.parentId
      ? familyResolvedCanonicalIds.get(item.platformProduct.parentId)
      : undefined;

    const hasFamilyConflict =
      unresolved &&
      !!item.platformProduct.parentId &&
      !!familyResolvedIds &&
      familyResolvedIds.size > 0 &&
      (!canonicalId || !familyResolvedIds.has(canonicalId));

    const isStaleClaim = unresolved && !!canonicalId && claimedIds.has(canonicalId);

    let reviewReason: ReviewReason | undefined;
    if (unresolved) {
      if (hasFamilyConflict) reviewReason = 'variant_mismatch';
      else if (isStaleClaim) reviewReason = 'stale_match';
      else if (item.action === 'UNMATCHED' && !canonicalId) reviewReason = 'no_match_found';
      else if (typeof item.confidence === 'number' && item.confidence < 0.7) reviewReason = 'low_confidence';
      else if (canonicalId) reviewReason = 'low_confidence';
      else reviewReason = 'no_match_found';
    }

    return { ...item, reviewReason, isStaleClaim };
  });
}

interface SearchResult {
  id: string;
  title: string;
  sku: string | null;
  price: number | null;
  imageUrl: string | null;
}

interface VariantFamily {
  parentId: string;
  parentTitle: string;
  items: AnnotatedSuggestion[];
}

type QuestId = 'new' | 'fuzzy' | 'variants';
type ScreenView =
  | { kind: 'lobby' }
  | { kind: 'lesson'; q: QuestId }
  | { kind: 'done'; q: QuestId }
  | { kind: 'resolve'; i: number };

const QUEST_ORDER: QuestId[] = ['new', 'fuzzy', 'variants'];
const QUEST_META: Record<QuestId, { title: string; sub: string; unit: string; accent: string; accentDark: string; short: string; doneLabel: string }> = {
  new: {
    title: 'New to your catalog',
    sub: "no match found · add as fresh products",
    unit: 'items',
    accent: QUEST.orange,
    accentDark: QUEST.orangeD,
    short: 'new',
    doneLabel: 'new products added',
  },
  fuzzy: {
    title: 'Confirm fuzzy matches',
    sub: '60–90% confidence · review 1-by-1',
    unit: 'items',
    accent: QUEST.yellow,
    accentDark: QUEST.yellowD,
    short: 'fuzzy',
    doneLabel: 'fuzzy matches confirmed',
  },
  variants: {
    title: 'Resolve variants',
    sub: "parent matched, variants don't line up",
    unit: 'products',
    accent: QUEST.blue,
    accentDark: QUEST.blueD,
    short: 'var',
    doneLabel: 'variant products resolved',
  },
};

// ── Issue grouping — fold the v2 resolver cases into lobby "issue" rows ──────
// Every MatchCase kind the backend can emit maps to one user-facing group, so
// the lobby surfaces ALL of them (variant families, consolidate, compare,
// collision, bundle/split, kit, stale, orphan, find) instead of three
// hardcoded buckets. The first non-empty group is the active step.
type IssueCategory =
  | 'fuzzy'
  | 'variants'
  | 'duplicates'
  | 'conflicts'
  | 'collisions'
  | 'bundles'
  | 'kits'
  | 'stale'
  | 'orphan'
  | 'find';

// Fuzzy first — the biggest pile with the easiest answer is the Duolingo
// opening move: one screen, one tap, huge visible progress.
const ISSUE_ORDER: IssueCategory[] = [
  'fuzzy',
  'variants',
  'duplicates',
  'conflicts',
  'collisions',
  'bundles',
  'kits',
  'stale',
  'orphan',
  'find',
];

function caseCategory(kind: MatchCase['kind']): IssueCategory {
  switch (kind) {
    case 'fuzzy':
      return 'fuzzy';
    case 'variants':
    case 'align':
    case 'onesided':
      return 'variants';
    case 'consolidate':
      return 'duplicates';
    case 'compare':
      return 'conflicts';
    case 'collision':
      return 'collisions';
    case 'split':
      return 'bundles';
    case 'kit':
      return 'kits';
    case 'stale':
      return 'stale';
    case 'orphan':
    case 'orphans':
      return 'orphan';
    case 'find':
    default:
      return 'find';
  }
}

const plural = (n: number) => (n === 1 ? '' : 's');

// Dead-simple groups — the title is the question, the sub is just a count.
const CAT_META: Record<IssueCategory, { icon: IconName; title: string; unit: string; sub: (n: number) => string }> = {
  fuzzy: {
    icon: 'check-decagram',
    title: 'Confirm matches',
    unit: 'items',
    sub: (n) => `${n} yes-or-no${n === 1 ? '' : 's'}`,
  },
  variants: {
    icon: 'puzzle',
    title: 'Group lookalikes',
    unit: 'products',
    sub: (n) => `${n} listing${plural(n)}`,
  },
  duplicates: {
    icon: 'content-copy',
    title: 'Combine duplicates',
    unit: 'items',
    sub: (n) => `${n} item${plural(n)}`,
  },
  conflicts: {
    icon: 'compare',
    title: 'Pick the right details',
    unit: 'items',
    sub: (n) => `${n} item${plural(n)}`,
  },
  collisions: {
    icon: 'swap-horizontal',
    title: 'Same SKU, different product?',
    unit: 'items',
    sub: (n) => `${n} SKU${plural(n)}`,
  },
  bundles: {
    icon: 'package-variant-closed',
    title: 'Split bundles',
    unit: 'bundles',
    sub: (n) => `${n} bundle${plural(n)}`,
  },
  kits: {
    icon: 'shape-outline',
    title: 'Link kits to pieces',
    unit: 'sets',
    sub: (n) => `${n} set${plural(n)}`,
  },
  stale: {
    icon: 'link-variant-off',
    title: 'Fix broken links',
    unit: 'links',
    sub: (n) => `${n} link${plural(n)}`,
  },
  orphan: {
    icon: 'tray-arrow-down',
    title: 'Keep or remove?',
    unit: 'items',
    sub: (n) => `${n} item${plural(n)}`,
  },
  find: {
    icon: 'magnify',
    title: 'Find a match',
    unit: 'items',
    sub: (n) => `${n} item${plural(n)}`,
  },
};

type RouteType = RouteProp<AppStackParamList, 'MappingReview'>;
type NavType = StackNavigationProp<AppStackParamList, 'MappingReview'>;

const MappingReviewScreen: React.FC = () => {
  const route = useRoute<RouteType>();
  const navigation = useNavigation<NavType>();
  const insets = useSafeAreaInsets();
  const { connectionId, platformName, importedProducts, isCSVImport, isScanning } = (route.params || {}) as any;

  const { progressByConnectionId } = usePlatformConnections();
  const syncProgress = progressByConnectionId[connectionId];
  const isScanningEarly =
    isScanning || syncProgress?.status === 'scanning' || syncProgress?.status === 'syncing';

  const session = useImportSession({
    connectionId,
    platformName,
    isCSVImport,
    importedProducts,
    skipInitialFetch: !!isScanningEarly,
    onNavigate: (screen, params) => navigation.navigate(screen as any, params),
  });

  const {
    suggestions,
    setSuggestions,
    loading,
    error,
    counts: hookCounts,
    wizardVisible,
    setWizardVisible,
    refreshSuggestions,
    submitImport,
    isSubmitting,
    connection,
  } = session;

  const [view, setView] = useState<ScreenView>({ kind: 'lobby' });
  const [searchSheet, setSearchSheet] = useState<{ visible: boolean; targetId: string | null }>({
    visible: false,
    targetId: null,
  });
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [doneVisible, setDoneVisible] = useState(false);
  const [lessonStart, setLessonStart] = useState(0);
  // Match-lobby sub-view: the queue of issues, the full inventory, or ignored.
  const [lobbyTab, setLobbyTab] = useState<'issues' | 'inventory' | 'ignored'>('issues');
  // "N matched themselves" receipt banner — collapsed by default, expands to a peek.
  const [autoOpen, setAutoOpen] = useState(false);
  // Resolver deck — frozen at entry so resolving cards doesn't reshuffle indices.
  const [deck, setDeck] = useState<MatchCase[]>([]);
  // Inventory / Ignored tab state: search, tap-for-detail, long-press multi-select.
  const [invSearch, setInvSearch] = useState('');
  const [selMode, setSelMode] = useState(false);
  const [selIds, setSelIds] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<AnnotatedSuggestion | null>(null);

  const annotated = useMemo<AnnotatedSuggestion[]>(
    () => annotateSuggestions(suggestions || []),
    [suggestions],
  );

  // Classify the draft into v2 resolver cases once — the lobby groups these
  // into issue rows, and the resolver deck steps through them in the same order.
  // autoResolved = matches identical on every field; they link without a card.
  const { cases, autoResolved } = useMemo(
    () => classifyMatch(annotated, platformName),
    [annotated, platformName],
  );

  useEffect(() => {
    if (!autoResolved.length) return;
    const ids = new Set(autoResolved);
    setSuggestions((prev) =>
      (prev || []).map((s) =>
        ids.has(s.platformProduct.id)
          ? { ...s, action: 'LINK_EXISTING', isSelected: true, resolved: true }
          : s,
      ),
    );
  }, [autoResolved, setSuggestions]);

  const matchedItems = useMemo(
    () => annotated.filter((s) => s.resolved && (s.action === 'LINK_EXISTING' || s.action === 'CREATE_NEW')),
    [annotated],
  );
  const autoMatched = useMemo(
    () => matchedItems.filter((s) => s.action === 'LINK_EXISTING'),
    [matchedItems],
  );

  const newItems = useMemo(
    () => annotated.filter((s) => s.reviewReason === 'no_match_found'),
    [annotated],
  );
  const fuzzyItems = useMemo(
    () =>
      annotated.filter(
        (s) =>
          s.reviewReason === 'low_confidence' ||
          s.reviewReason === 'duplicate' ||
          s.reviewReason === 'stale_match',
      ),
    [annotated],
  );
  const variantFamilies = useMemo<VariantFamily[]>(() => {
    const byParent = new Map<string, AnnotatedSuggestion[]>();
    annotated.forEach((s) => {
      if (s.reviewReason !== 'variant_mismatch') return;
      const pid = s.platformProduct.parentId || s.platformProduct.id;
      if (!byParent.has(pid)) byParent.set(pid, []);
      byParent.get(pid)!.push(s);
    });
    return Array.from(byParent.entries()).map(([parentId, items]) => ({
      parentId,
      parentTitle: items[0]?.platformProduct.parentTitle || items[0]?.platformProduct.title || 'Product',
      items,
    }));
  }, [annotated]);

  const questCount = useCallback(
    (q: QuestId) =>
      q === 'new' ? newItems.length : q === 'fuzzy' ? fuzzyItems.length : variantFamilies.length,
    [newItems.length, fuzzyItems.length, variantFamilies.length],
  );

  const activeQuest = useMemo<QuestId | null>(
    () => QUEST_ORDER.find((q) => questCount(q) > 0) || null,
    [questCount],
  );
  const questState = useCallback(
    (q: QuestId): 'done' | 'active' | 'locked' => {
      if (questCount(q) === 0) return 'done';
      if (q === activeQuest) return 'active';
      return 'locked';
    },
    [questCount, activeQuest],
  );

  const itemsLeft = newItems.length + fuzzyItems.length + variantFamilies.reduce((n, f) => n + f.items.length, 0);

  // Items still needing a decision across the v2 cases (the receipt math).
  const itemsLeftCount = useMemo(
    () => cases.reduce((n, c) => n + (c.itemIds?.length || 1), 0),
    [cases],
  );

  // ── Match-lobby derivations (issues queue · inventory · ignored) ──────────
  const ignoredItems = useMemo(
    () => annotated.filter((s) => s.action === 'IGNORE'),
    [annotated],
  );

  // The list behind the Inventory/Ignored tabs, filtered by the search box.
  const invFiltered = useMemo(() => {
    const base = lobbyTab === 'ignored' ? ignoredItems : annotated;
    const q = invSearch.trim().toLowerCase();
    if (!q) return base;
    return base.filter(
      (s) =>
        (s.platformProduct.title || '').toLowerCase().includes(q) ||
        (s.platformProduct.sku || '').toLowerCase().includes(q) ||
        (s.suggestedCanonicalProduct?.title || '').toLowerCase().includes(q),
    );
  }, [lobbyTab, ignoredItems, annotated, invSearch]);

  const toInvItem = useCallback(
    (s: AnnotatedSuggestion): InventoryItemData => {
      const p = s.platformProduct;
      const priceNum = typeof p.price === 'number' ? p.price : Number(p.price);
      const price = priceNum > 0 ? `$${priceNum.toFixed(2)}` : undefined;
      let statusLabel = 'New';
      if (s.action === 'IGNORE') statusLabel = 'Ignored';
      else if (s.resolved && (s.action === 'LINK_EXISTING' || s.action === 'CREATE_NEW')) statusLabel = 'Matched';
      else if (s.reviewReason) statusLabel = 'Needs answer';
      return {
        id: p.id,
        title: p.title || 'Untitled',
        price,
        sku: p.sku || undefined,
        imageUrl: p.imageUrl,
        platforms: [platformName],
        statusLabel,
      };
    },
    [platformName],
  );

  // Enter the v2 resolver deck. The deck is FILTERED to the tapped group, so
  // the progress bar reads "3/46" (this group), never "48/343" (everything) —
  // and finishing the group drops you back in the lobby with it cleared.
  const enterResolve = useCallback(
    (cat?: IssueCategory) => {
      const filtered = cat ? cases.filter((c) => caseCategory(c.kind) === cat) : cases;
      if (filtered.length === 0) return;
      setDeck(filtered);
      setView({ kind: 'resolve', i: 0 });
    },
    [cases],
  );

  // Jump straight to ONE item's card (from the item detail sheet's "Fix now").
  const enterResolveCase = useCallback((mc: MatchCase) => {
    setDeck([mc]);
    setView({ kind: 'resolve', i: 0 });
  }, []);

  // One lobby "issue" row per non-empty category, ordered, first = active step.
  // The pill + CTA count CARDS (questions to answer = real effort); the sub
  // describes ITEMS (what those questions cover) — they differ when cards
  // batch many items (variant families, the orphans list).
  const issues = useMemo<LaneIssue[]>(() => {
    const byCat = new Map<IssueCategory, { cards: number; items: number; thumbs: string[] }>();
    cases.forEach((c) => {
      const cat = caseCategory(c.kind);
      const e = byCat.get(cat) || { cards: 0, items: 0, thumbs: [] };
      e.cards += 1;
      e.items += c.itemIds?.length || 1;
      // Real product art for the row's stack — what the group is ABOUT.
      if (e.thumbs.length < 3) {
        const pool = [
          c.itemImage,
          c.bImage,
          c.aImage,
          ...(c.candidates || []).map((x) => x.uri),
        ].filter((u): u is string => !!u);
        for (const u of pool) {
          if (e.thumbs.length >= 3) break;
          if (!e.thumbs.includes(u)) e.thumbs.push(u);
        }
      }
      byCat.set(cat, e);
    });
    const present = ISSUE_ORDER.filter((cat) => byCat.has(cat));
    return present.map((cat, i) => {
      const meta = CAT_META[cat];
      const e = byCat.get(cat)!;
      return {
        id: cat,
        icon: meta.icon,
        title: meta.title,
        sub: meta.sub(e.items),
        count: e.cards,
        state: i === 0 ? 'active' : 'locked',
        ctaLabel: `Answer ${e.cards} question${e.cards === 1 ? '' : 's'}`,
        onFix: () => enterResolve(cat),
        thumbs: e.thumbs.length ? e.thumbs : undefined,
        extra: e.thumbs.length ? Math.max(0, e.items - e.thumbs.length) : undefined,
      };
    });
  }, [cases, enterResolve]);

  // Write a card's decision back onto the draft so the lobby reflects progress.
  // meta.selectedIds: rows the user kept ticked — unticked rows get the alt
  // treatment instead of silently riding along with the primary action.
  // meta.unlink: break the link (stale/orphan delist) → IGNORE.
  const applyDecision = useCallback(
    (c: MatchCase, d: Decision, meta?: ResolveMeta) => {
      const ids = new Set(c.itemIds || []);
      const selected = meta?.selectedIds ? new Set(meta.selectedIds) : null;
      setSuggestions((prev) =>
        (prev || []).map((s) => {
          if (!ids.has(s.platformProduct.id)) return s;
          if (meta?.unlink || meta?.ignore) {
            return { ...s, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false };
          }
          if (d === 'primary' && meta?.linkTo) {
            // Link to the exact item the user picked (search may have replaced
            // the backend's original candidate).
            return {
              ...s,
              action: 'LINK_EXISTING',
              isSelected: true,
              resolved: true,
              suggestedCanonicalProduct: {
                id: meta.linkTo.id,
                title: meta.linkTo.title,
                sku: meta.linkTo.sku || '',
                price: meta.linkTo.price ?? undefined,
                imageUrl: meta.linkTo.uri ?? null,
              },
            };
          }
          if (d === 'primary' && c.kind === 'find' && !meta?.linkTo) {
            // Find with nothing picked = "Add as new product", even when the
            // draft still carries a (rejected) backend candidate.
            return applyMatchDecision(s, 'find', 'alt');
          }
          if (d === 'primary' && selected && !selected.has(s.platformProduct.id)) {
            // Batched orphans: un-ticked = "it's gone" → delist (ignorable, restorable).
            if (c.kind === 'orphans') {
              return { ...s, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false };
            }
            // Fuzzy batch: un-checked = a doubt — leave it untouched so it
            // falls to the one-by-one deck instead of silently deciding.
            if (c.kind === 'fuzzy') {
              return s;
            }
            return applyMatchDecision(s, c.kind, 'alt');
          }
          return applyMatchDecision(s, c.kind, d);
        }),
      );
    },
    [setSuggestions],
  );

  // Live catalog search for the find/relink cards — same in-memory pool the
  // old SearchSheet used (canonical products + anorha variants on the draft).
  const searchCatalog = useCallback(
    (q: string): CandidateItem[] => {
      const query = q.trim().toLowerCase();
      if (!query) return [];
      const seen = new Set<string>();
      const out: CandidateItem[] = [];
      const consider = (
        id?: string | null,
        title?: string | null,
        sku?: string | null,
        price?: number | null,
        imageUrl?: string | null,
      ) => {
        if (!id || seen.has(id)) return;
        const t = (title || '').toLowerCase();
        const k = (sku || '').toLowerCase();
        if (!t.includes(query) && !k.includes(query)) return;
        seen.add(id);
        out.push({
          id,
          title: title || 'Untitled',
          sub: `${sku || 'no sku'}${typeof price === 'number' && price > 0 ? ` · $${price.toFixed(2)}` : ''}`,
          uri: imageUrl ?? null,
          sku: sku ?? null,
          price: price ?? null,
        });
      };
      for (const s of annotated) {
        const c = s.suggestedCanonicalProduct;
        if (c) consider(c.id, c.title, c.sku, c.price ?? null, c.imageUrl ?? null);
        const v = s.anorhaVariant;
        if (v) consider(v.id, v.title, v.sku, v.price ?? null, v.imageUrl ?? null);
        if (out.length >= 8) break;
      }
      return out;
    },
    [annotated],
  );

  // ---------------------------------------------------------------------------
  // Polling for scan completion (unchanged behavior)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (!connectionId || !isScanningEarly) return;
    const interval = setInterval(() => {
      const status = syncProgress?.status;
      if (status === 'review' || status === 'active' || status === 'completed') {
        refreshSuggestions();
        clearInterval(interval);
      }
    }, 2500);
    return () => clearInterval(interval);
  }, [connectionId, isScanningEarly, syncProgress?.status, refreshSuggestions]);

  // Search filter (unchanged behavior)
  useEffect(() => {
    if (!searchSheet.visible) return;
    setSearchLoading(true);
    const t = setTimeout(() => {
      const q = searchQuery.trim().toLowerCase();
      const seen = new Set<string>();
      const results: SearchResult[] = [];
      annotated.forEach((s) => {
        const c = s.suggestedCanonicalProduct;
        if (c?.id && !seen.has(c.id)) {
          if (!q || c.title.toLowerCase().includes(q) || (c.sku || '').toLowerCase().includes(q)) {
            seen.add(c.id);
            results.push({
              id: c.id,
              title: c.title,
              sku: c.sku || null,
              price: c.price ?? null,
              imageUrl: c.imageUrl ?? null,
            });
          }
        }
        const v = s.anorhaVariant;
        if (v?.id && !seen.has(v.id)) {
          if (!q || (v.title || '').toLowerCase().includes(q) || (v.sku || '').toLowerCase().includes(q)) {
            seen.add(v.id);
            results.push({
              id: v.id,
              title: v.title || 'Untitled',
              sku: v.sku,
              price: v.price ?? null,
              imageUrl: v.imageUrl ?? null,
            });
          }
        }
      });
      setSearchResults(results.slice(0, 50));
      setSearchLoading(false);
    }, 150);
    return () => clearTimeout(t);
  }, [searchQuery, searchSheet.visible, annotated]);

  // ---------------------------------------------------------------------------
  // Action helpers (unchanged behavior — drive useImportSession suggestions)
  // ---------------------------------------------------------------------------
  const updateOne = useCallback(
    (id: string, patch: (s: MappingSuggestion) => MappingSuggestion) => {
      setSuggestions((prev) => (prev || []).map((s) => (s.platformProduct.id === id ? patch(s) : s)));
    },
    [setSuggestions],
  );

  const handleConfirm = useCallback(
    (item: AnnotatedSuggestion) => {
      if (!item.suggestedCanonicalProduct?.id) return;
      updateOne(item.platformProduct.id, (s) => ({
        ...s,
        action: 'LINK_EXISTING',
        isSelected: true,
        resolved: true,
      }));
    },
    [updateOne],
  );

  const handleAddNew = useCallback(
    (item: AnnotatedSuggestion) => {
      updateOne(item.platformProduct.id, (s) => ({
        ...s,
        action: 'CREATE_NEW',
        isSelected: true,
        resolved: true,
      }));
    },
    [updateOne],
  );

  const handleSkip = useCallback(
    (item: AnnotatedSuggestion) => {
      updateOne(item.platformProduct.id, (s) => ({
        ...s,
        prevAction: s.action,
        action: 'IGNORE',
        isSelected: false,
        resolved: false,
      }));
    },
    [updateOne],
  );

  const resolveItem = useCallback(
    (item: AnnotatedSuggestion) => {
      if (item.suggestedCanonicalProduct?.id && !item.isStaleClaim) handleConfirm(item);
      else handleAddNew(item);
    },
    [handleConfirm, handleAddNew],
  );

  const openSearchFor = useCallback((item: AnnotatedSuggestion) => {
    setSearchSheet({ visible: true, targetId: item.platformProduct.id });
    setSearchQuery('');
  }, []);

  // ── Inventory / Ignored tab actions ────────────────────────────────────────
  const ignoreIds = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      setSuggestions((prev) =>
        (prev || []).map((s) =>
          set.has(s.platformProduct.id)
            ? { ...s, prevAction: s.action, action: 'IGNORE', isSelected: false, resolved: false }
            : s,
        ),
      );
    },
    [setSuggestions],
  );

  const restoreIds = useCallback(
    (ids: string[]) => {
      const set = new Set(ids);
      setSuggestions((prev) =>
        (prev || []).map((s) =>
          set.has(s.platformProduct.id)
            ? {
                ...s,
                action: s.prevAction && s.prevAction !== 'IGNORE' ? s.prevAction : 'UNMATCHED',
                prevAction: undefined,
                isSelected: true,
                resolved: false,
              }
            : s,
        ),
      );
    },
    [setSuggestions],
  );

  const exitSelection = useCallback(() => {
    setSelMode(false);
    setSelIds(new Set());
  }, []);

  const toggleSel = useCallback((id: string) => {
    setSelIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  // Tab switches reset search + selection so state never leaks across lists.
  const switchTab = useCallback(
    (tab: 'issues' | 'inventory' | 'ignored') => {
      setLobbyTab(tab);
      setInvSearch('');
      exitSelection();
    },
    [exitSelection],
  );

  // The open resolver card for an item, if it still needs a decision.
  const caseForItem = useCallback(
    (id: string) => cases.find((mc) => (mc.itemIds || []).includes(id)) || null,
    [cases],
  );

  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      if (!searchSheet.targetId) return;
      updateOne(searchSheet.targetId, (s) => ({
        ...s,
        action: 'LINK_EXISTING',
        isSelected: true,
        resolved: true,
        suggestedCanonicalProduct: {
          id: result.id,
          sku: result.sku || '',
          title: result.title,
          price: result.price ?? undefined,
          imageUrl: result.imageUrl ?? null,
        },
      }));
      setSearchSheet({ visible: false, targetId: null });
    },
    [searchSheet.targetId, updateOne],
  );

  const handleConfirmMapping = useCallback(async () => {
    try {
      await submitImport();
      setDoneVisible(false);
    } catch (e: any) {
      Alert.alert('Could not confirm mapping', e?.message || 'Please try again.');
    }
  }, [submitImport]);

  // When the current lesson's queue empties, advance to the quest-done screen.
  useEffect(() => {
    if (view.kind !== 'lesson') return;
    if (questCount(view.q) === 0) setView({ kind: 'done', q: view.q });
  }, [view, questCount]);

  const enterLesson = useCallback(
    (q: QuestId) => {
      setLessonStart(questCount(q));
      setView({ kind: 'lesson', q });
    },
    [questCount],
  );

  const goNextAfterDone = useCallback(() => {
    const next = activeQuest;
    if (next) enterLesson(next);
    else setView({ kind: 'lobby' });
  }, [activeQuest, enterLesson]);

  // ---------------------------------------------------------------------------
  // Segmented bar model
  // ---------------------------------------------------------------------------
  const segmentsFor = useCallback(
    (current: QuestId | null, withLabel?: string): QuestSegment[] => {
      const segs: QuestSegment[] = [
        { n: Math.max(autoMatched.length, 1), done: true, short: 'auto' },
      ];
      QUEST_ORDER.forEach((q) => {
        const c = questCount(q);
        const meta = QUEST_META[q];
        segs.push({
          n: Math.max(c, 1),
          done: c === 0,
          color: meta.accent,
          short: meta.short,
          label: current === q ? withLabel || meta.short : undefined,
        });
      });
      return segs;
    },
    [autoMatched.length, questCount],
  );
  const activeSegIdx = useCallback(
    (q: QuestId | null) => (q ? QUEST_ORDER.indexOf(q) + 1 : QUEST_ORDER.length),
    [],
  );

  // ---------------------------------------------------------------------------
  // Scanning / loading / error
  // ---------------------------------------------------------------------------
  if (loading || isScanningEarly) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <LobbyHeader title="Match" onBack={() => navigation.goBack()} />
        <View style={styles.centerBlock}>
          <ActivityIndicator size="large" color={QUEST.green} />
          <Text style={styles.centerTitle}>Analyzing {platformName}…</Text>
          {!!syncProgress?.description && <Text style={styles.centerSub}>{syncProgress.description}</Text>}
        </View>
      </View>
    );
  }

  if (error) {
    return (
      <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
        <LobbyHeader title="Match" onBack={() => navigation.goBack()} />
        <View style={styles.centerBlock}>
          <Icon name="alert-circle-outline" size={32} color={QUEST.orange} />
          <Text style={styles.centerTitle}>{error}</Text>
          <TouchableOpacity onPress={refreshSuggestions} style={styles.retryBtn}>
            <Text style={styles.retryBtnText}>Try again</Text>
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // ---------------------------------------------------------------------------
  // Quest done screen
  // ---------------------------------------------------------------------------
  if (view.kind === 'done') {
    const meta = QUEST_META[view.q];
    const next = activeQuest;
    const nextMeta = next ? QUEST_META[next] : null;
    return (
      <QuestDone
        segments={segmentsFor(view.q, meta.short)}
        activeIdx={activeSegIdx(view.q)}
        topInset={insets.top}
        onClose={() => setView({ kind: 'lobby' })}
        count={lessonStart}
        label={meta.doneLabel}
        next={
          nextMeta && next
            ? {
                count: questCount(next),
                unit: nextMeta.unit,
                title: nextMeta.title,
                sub: nextMeta.sub,
                accent: nextMeta.accent,
                tag: 'up next',
              }
            : {
                count: matchedItems.length,
                unit: 'ready',
                title: 'All matched',
                sub: 'confirm the mapping to finish',
                accent: QUEST.green,
                tag: 'ready',
              }
        }
        onContinue={goNextAfterDone}
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Lesson — stack (new / fuzzy) or variant family
  // ---------------------------------------------------------------------------
  if (view.kind === 'lesson') {
    const meta = QUEST_META[view.q];
    const segs = segmentsFor(view.q);

    if (view.q === 'variants') {
      const family = variantFamilies[0];
      if (!family) return null;
      const unresolved = family.items.filter((v) => !v.resolved && v.action !== 'IGNORE');
      return (
        <>
          <LessonShell
            segments={segs}
            activeIdx={activeSegIdx(view.q)}
            topInset={insets.top}
            onClose={() => setView({ kind: 'lobby' })}
          >
            <View style={styles.parentRow}>
              <Thumb uri={family.items[0]?.platformProduct.imageUrl} size={52} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.kicker}>PARENT PRODUCT</Text>
                <Text style={styles.parentTitle} numberOfLines={1}>
                  {family.parentTitle}
                </Text>
                <Text style={styles.parentSub}>
                  {family.items.length} variants · {unresolved.length} need your eye
                </Text>
              </View>
            </View>

            <View style={{ gap: 8 }}>
              {family.items.map((v) => {
                const linked = !!v.suggestedCanonicalProduct?.id && !v.isStaleClaim;
                const tone = v.resolved
                  ? { bg: QUEST.greenSoft, border: QUEST.greenBorder, color: QUEST.greenD, label: 'linked' }
                  : linked
                    ? { bg: QUEST.yellowSoft, border: QUEST.yellowBorder, color: QUEST.yellowD, label: 'confirm' }
                    : { bg: QUEST.orangeSoft, border: QUEST.orangeBorder, color: QUEST.orangeD, label: 'create new' };
                return (
                  <View key={v.platformProduct.id} style={[styles.vRow, { backgroundColor: tone.bg, borderColor: tone.border }]}>
                    <View style={styles.vChip}>
                      <Text style={styles.vChipText}>
                        {(v.platformProduct.title || '?').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <Text style={styles.vTitle} numberOfLines={1}>
                        {v.platformProduct.title || 'Variant'}
                        {!!v.platformProduct.sku && <Text style={styles.vSku}> · {v.platformProduct.sku}</Text>}
                      </Text>
                      <Text style={[styles.vState, { color: tone.color }]} numberOfLines={1}>
                        {v.suggestedCanonicalProduct?.title
                          ? `→ ${v.suggestedCanonicalProduct.title} · ${tone.label}`
                          : tone.label}
                      </Text>
                    </View>
                    {v.resolved ? (
                      <Icon name="check" size={16} color={QUEST.greenD} />
                    ) : (
                      <View style={{ flexDirection: 'row', gap: 6 }}>
                        <TouchableOpacity
                          onPress={() => resolveItem(v)}
                          style={[styles.vMini, { backgroundColor: QUEST.ink }]}
                        >
                          <Icon name="check" size={12} color="#fff" />
                        </TouchableOpacity>
                        <TouchableOpacity
                          onPress={() => handleSkip(v)}
                          style={[styles.vMini, styles.vMiniGhost]}
                        >
                          <Icon name="close" size={11} color={QUEST.sub} />
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>
                );
              })}
            </View>

            <View style={styles.lessonActions}>
              <QuestCTA
                label="Skip product"
                color={QUEST.surface}
                dark={QUEST.borderDark}
                textColor={QUEST.sub}
                flex={1}
                onPress={() => family.items.forEach((v) => handleSkip(v))}
              />
              <QuestCTA
                label={`Confirm all ${family.items.length}`}
                icon="check"
                color={QUEST.green}
                dark={QUEST.greenD}
                flex={2}
                onPress={() => unresolved.forEach((v) => resolveItem(v))}
              />
            </View>
          </LessonShell>
          {renderSearchSheet()}
        </>
      );
    }

    // Stack lesson — new / fuzzy
    const queue = view.q === 'new' ? newItems : fuzzyItems;
    const item = queue[0];
    if (!item) return null;
    const hasMatch = !!item.suggestedCanonicalProduct?.id && !item.isStaleClaim;
    const conf = typeof item.confidence === 'number' ? Math.round(item.confidence * 100) : null;

    return (
      <>
        <LessonShell
          segments={segs}
          activeIdx={activeSegIdx(view.q)}
          topInset={insets.top}
          onClose={() => setView({ kind: 'lobby' })}
        >
          <Text style={styles.kicker}>FROM {String(platformName || '').toUpperCase()}</Text>
          <View style={styles.fromRow}>
            <Thumb uri={item.platformProduct.imageUrl} size={56} />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.fromTitle} numberOfLines={2}>
                {item.platformProduct.title || 'Untitled'}
              </Text>
              <Text style={styles.fromSub} numberOfLines={1}>
                {item.platformProduct.sku ? `SKU ${item.platformProduct.sku}` : ''}
                {item.platformProduct.price
                  ? `${item.platformProduct.sku ? ' · ' : ''}$${item.platformProduct.price.toFixed(2)}`
                  : ''}
              </Text>
            </View>
          </View>

          <View style={styles.connector}>
            <View style={styles.connectorLine} />
            {hasMatch && (
              <View style={styles.confPill}>
                <Icon name="check" size={11} color={QUEST.yellowD} />
                <Text style={styles.confPillText}>{conf != null ? `${conf}% match` : 'suggested'}</Text>
              </View>
            )}
            <View style={styles.connectorLine} />
          </View>

          {hasMatch ? (
            <View style={styles.candidate}>
              <View style={styles.candidateHead}>
                <Text style={[styles.kicker, { color: QUEST.yellowD }]}>YOUR CATALOG</Text>
                <TouchableOpacity onPress={() => openSearchFor(item)}>
                  <Text style={styles.changeLink}>change</Text>
                </TouchableOpacity>
              </View>
              <View style={styles.fromRow}>
                <Thumb uri={item.suggestedCanonicalProduct?.imageUrl} size={48} />
                <View style={{ flex: 1, minWidth: 0 }}>
                  <Text style={styles.candidateTitle} numberOfLines={2}>
                    {item.suggestedCanonicalProduct?.title || 'Untitled'}
                  </Text>
                  <Text style={styles.candidateSub} numberOfLines={1}>
                    {item.suggestedCanonicalProduct?.sku ? `SKU ${item.suggestedCanonicalProduct.sku}` : 'In your catalog'}
                  </Text>
                </View>
              </View>
              <View style={styles.whyBox}>
                <Icon name="auto-fix" size={12} color={QUEST.sub} />
                <Text style={styles.whyText}>
                  <Text style={{ fontFamily: QFONT.b, color: QUEST.ink }}>Why this match? </Text>
                  Similar SKU prefix, title, and category.
                </Text>
              </View>
            </View>
          ) : (
            <Pressable onPress={() => openSearchFor(item)} style={styles.noMatch}>
              <Icon name="magnify" size={22} color={QUEST.muted} />
              <Text style={styles.noMatchTitle}>No match found</Text>
              <Text style={styles.noMatchSub}>Tap to search your catalog, or add as a new product below.</Text>
            </Pressable>
          )}

          <View style={styles.lessonActions}>
            <QuestCTA
              label="Skip"
              color={QUEST.surface}
              dark={QUEST.borderDark}
              textColor={QUEST.sub}
              flex={1}
              onPress={() => handleSkip(item)}
            />
            {hasMatch ? (
              <QuestCTA
                label="Yes, link"
                icon="check"
                color={QUEST.green}
                dark={QUEST.greenD}
                flex={2}
                onPress={() => handleConfirm(item)}
              />
            ) : (
              <QuestCTA
                label="Add as new"
                icon="plus"
                color={QUEST.green}
                dark={QUEST.greenD}
                flex={2}
                onPress={() => handleAddNew(item)}
              />
            )}
          </View>
        </LessonShell>
        {renderSearchSheet()}
      </>
    );
  }

  // ---------------------------------------------------------------------------
  // Lobby
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Resolver deck (v2) — one card per classified case from the mapping draft.
  // ---------------------------------------------------------------------------
  if (view.kind === 'resolve') {
    const total = deck.length;
    const di = Math.min(view.i, Math.max(total - 1, 0));
    const cur = deck[di];
    if (!cur) {
      return (
        <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
          <LobbyHeader title="Match" onBack={() => setView({ kind: 'lobby' })} />
          <View style={styles.mlEmpty}>
            <Icon name="check-decagram" size={40} color={RC.green} />
            <Text style={styles.mlEmptyTitle}>All resolved</Text>
            <Text style={styles.mlEmptySub}>Every flagged item has a decision.</Text>
          </View>
        </View>
      );
    }
    return (
      <MatchResolver
        // Keyed by case id so each card mounts fresh — without this, React
        // reuses the previous card's local state (stale picks, wrong counts,
        // negative "still unplaced" gates) whenever two cards share a kind.
        key={cur.id}
        c={cur}
        idx={di + 1}
        total={total}
        topInset={insets.top}
        // Back = exit to the lobby (Duolingo's X). Cards auto-advance and
        // decisions are already written back, so stepping backwards through
        // answered cards only ever confused people.
        onBack={() => setView({ kind: 'lobby' })}
        onSearch={searchCatalog}
        onResolve={(d, meta) => {
          applyDecision(cur, d, meta);
          if (di + 1 < total) setView({ kind: 'resolve', i: di + 1 });
          else setView({ kind: 'lobby' });
        }}
      />
    );
  }

  const questsDone = QUEST_ORDER.filter((q) => questCount(q) === 0).length;

  function renderSearchSheet() {
    return (
      <SearchSheet
        visible={searchSheet.visible}
        onClose={() => setSearchSheet({ visible: false, targetId: null })}
        query={searchQuery}
        onQueryChange={setSearchQuery}
        results={searchResults}
        loading={searchLoading}
        onSelect={handleSearchSelect}
      />
    );
  }

  return (
    <View style={[styles.screen, { paddingTop: insets.top + 6 }]}>
      <LobbyHeader
        title={lobbyTab === 'inventory' ? 'Inventory' : lobbyTab === 'ignored' ? 'Ignored Items' : 'Match'}
        countSuffix={lobbyTab === 'issues' ? `${annotated.length} Items` : undefined}
        onBack={() => (lobbyTab === 'issues' ? navigation.goBack() : switchTab('issues'))}
        right={
          lobbyTab === 'issues' ? (
            <HeaderIconGroup
              items={[
                { icon: 'package-variant-closed', onPress: () => switchTab('inventory') },
                { icon: 'trash-can-outline', onPress: () => switchTab('ignored') },
              ]}
            />
          ) : undefined
        }
      />

      {lobbyTab === 'issues' && (
        <ScrollView contentContainerStyle={styles.lobbyScroll} showsVerticalScrollIndicator={false}>
          {matchedItems.length > 0 && (
            <TouchableOpacity activeOpacity={0.85} onPress={() => setAutoOpen((v) => !v)} style={styles.mlClearBanner}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <View style={styles.mlClearIcon}>
                  <Icon name="check-bold" size={15} color={RC.greenDark} />
                </View>
                <Text style={styles.mlClearText} numberOfLines={1}>
                  {matchedItems.length} matched themselves
                </Text>
                <Icon name={autoOpen ? 'chevron-down' : 'chevron-right'} size={18} color={RC.greenDark} />
              </View>
              {autoOpen && (
                <View style={{ paddingTop: 10, gap: 7 }}>
                  {matchedItems.slice(0, 3).map((s) => (
                    <View key={s.platformProduct.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, opacity: 0.85 }}>
                      {s.platformProduct.imageUrl ? (
                        <Image source={{ uri: s.platformProduct.imageUrl }} style={styles.mlPeekThumb} />
                      ) : (
                        <View style={[styles.mlPeekThumb, { backgroundColor: RC.greenLine }]} />
                      )}
                      <Text style={styles.mlPeekTitle} numberOfLines={1}>
                        {s.platformProduct.title || 'Untitled'}
                      </Text>
                      <Text style={styles.mlPeekHow}>
                        {s.matchType === 'BARCODE' ? 'barcode =' : s.matchType === 'SKU' ? 'SKU =' : 'matched'}
                      </Text>
                    </View>
                  ))}
                  <TouchableOpacity onPress={() => switchTab('inventory')} hitSlop={{ top: 6, bottom: 6 }}>
                    <Text style={styles.mlPeekLink}>View all {matchedItems.length}</Text>
                  </TouchableOpacity>
                </View>
              )}
            </TouchableOpacity>
          )}

          {issues.length === 0 ? (
            <View style={styles.mlEmpty}>
              <Icon name="check-decagram" size={40} color={RC.green} />
              <Text style={styles.mlEmptyTitle}>No issues to fix</Text>
              <Text style={styles.mlEmptySub}>Every item is matched and ready to confirm.</Text>
            </View>
          ) : (
            <>
              <Text style={styles.lobbySection}>TO SORT</Text>
              <IssueLane issues={issues} />
            </>
          )}
        </ScrollView>
      )}

      {(lobbyTab === 'inventory' || lobbyTab === 'ignored') && (
        <>
          {selMode ? (
            <View style={styles.selHeader}>
              <TouchableOpacity onPress={exitSelection} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                <Icon name="close" size={20} color={RC.ink} />
              </TouchableOpacity>
              <Text style={styles.selHeaderText}>{selIds.size} selected</Text>
              <TouchableOpacity
                onPress={() =>
                  setSelIds(
                    selIds.size === invFiltered.length
                      ? new Set()
                      : new Set(invFiltered.map((s) => s.platformProduct.id)),
                  )
                }
              >
                <Text style={styles.selHeaderLink}>
                  {selIds.size === invFiltered.length ? 'Deselect all' : 'Select all'}
                </Text>
              </TouchableOpacity>
            </View>
          ) : (
            <View style={styles.invSearchWrap}>
              <Icon name="magnify" size={20} color={RC.muted} />
              <TextInput
                value={invSearch}
                onChangeText={setInvSearch}
                placeholder="Search by name or SKU…"
                placeholderTextColor="#999"
                style={styles.invSearchInput}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
              />
              {!!invSearch && (
                <TouchableOpacity onPress={() => setInvSearch('')} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Icon name="close-circle" size={18} color={RC.faint} />
                </TouchableOpacity>
              )}
            </View>
          )}

          <FlatList
            data={invFiltered}
            keyExtractor={(s, i) => s.platformProduct.id || String(i)}
            renderItem={({ item }) => {
              const id = item.platformProduct.id;
              return (
                <InventoryRow
                  item={{ ...toInvItem(item), selected: selIds.has(id) }}
                  selectionMode={selMode}
                  onPress={() => (selMode ? toggleSel(id) : setDetail(item))}
                  onLongPress={() => {
                    if (!selMode) {
                      setSelMode(true);
                      setSelIds(new Set([id]));
                    }
                  }}
                />
              );
            }}
            ItemSeparatorComponent={() => <View style={styles.mlSep} />}
            contentContainerStyle={styles.mlList}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            ListEmptyComponent={
              <View style={styles.mlEmpty}>
                <Icon
                  name={lobbyTab === 'ignored' ? 'trash-can-outline' : 'magnify'}
                  size={36}
                  color={RC.muted}
                />
                <Text style={styles.mlEmptyTitle}>
                  {invSearch.trim()
                    ? 'No items match your search'
                    : lobbyTab === 'ignored'
                      ? 'No ignored items'
                      : 'Nothing imported yet'}
                </Text>
                {lobbyTab === 'ignored' && !invSearch.trim() && (
                  <Text style={styles.mlEmptySub}>Items you ignore land here — restore them any time.</Text>
                )}
              </View>
            }
          />
        </>
      )}

      {lobbyTab === 'issues' && (
        <>
          <LinearGradient
            colors={['rgba(255,255,255,0)', '#FFFFFF']}
            style={styles.fade}
            pointerEvents="none"
          />
          {issues.length === 0 ? (
            <BottomActionBar
              primaryLabel={`Confirm mapping (${matchedItems.length})`}
              primaryIcon={<Icon name="check" size={20} color="#fff" />}
              onPrimary={() => setDoneVisible(true)}
            />
          ) : (
            <BottomActionBar
              tertiaryContent={
                <View style={styles.footerProgress}>
                  <MiniProgress
                    pct={annotated.length ? ((annotated.length - itemsLeftCount) / annotated.length) * 100 : 0}
                    left={`${annotated.length - itemsLeftCount} of ${annotated.length}`}
                    right={`${annotated.length ? Math.round(((annotated.length - itemsLeftCount) / annotated.length) * 100) : 0}%`}
                  />
                </View>
              }
              primaryLabel={`Start · ${issues[0].title}`}
              primaryIcon={<Icon name="arrow-right" size={20} color="#fff" />}
              primaryButtonStyle={{ backgroundColor: RC.orange }}
              onPrimary={() => issues[0].onFix?.()}
            />
          )}
        </>
      )}

      {lobbyTab !== 'issues' && selMode && selIds.size > 0 && (
        <BottomActionBar
          primaryLabel={
            lobbyTab === 'ignored' ? `Restore ${selIds.size}` : `Ignore ${selIds.size}`
          }
          primaryIcon={
            <Icon name={lobbyTab === 'ignored' ? 'restore' : 'eye-off-outline'} size={20} color="#fff" />
          }
          onPrimary={() => {
            const ids = Array.from(selIds);
            if (lobbyTab === 'ignored') restoreIds(ids);
            else ignoreIds(ids);
            exitSelection();
          }}
          secondaryLabel="Cancel"
          onSecondary={exitSelection}
        />
      )}

      {detail && (
        <ItemSheet
          item={detail}
          isIgnored={detail.action === 'IGNORE'}
          openCase={caseForItem(detail.platformProduct.id)}
          onClose={() => setDetail(null)}
          onIgnore={() => {
            ignoreIds([detail.platformProduct.id]);
            setDetail(null);
          }}
          onRestore={() => {
            restoreIds([detail.platformProduct.id]);
            setDetail(null);
          }}
          onFix={(mc) => {
            setDetail(null);
            enterResolveCase(mc);
          }}
        />
      )}

      {renderSearchSheet()}

      {doneVisible && (
        <DoneOverlay
          insets={insets}
          linkedCount={matchedItems.length}
          skippedCount={annotated.filter((s) => s.action === 'IGNORE').length}
          onConfirm={handleConfirmMapping}
          onBack={() => setDoneVisible(false)}
          isSubmitting={isSubmitting}
        />
      )}

      <ImportWizardSheet
        visible={wizardVisible}
        onClose={() => setWizardVisible(false)}
        platformName={platformName}
        connection={connection}
        counts={hookCounts}
        session={session}
        showReselectMatches={false}
      />
    </View>
  );
};

// ---------------------------------------------------------------------------
// Thumb
// ---------------------------------------------------------------------------
function Thumb({ uri, size }: { uri?: string | null; size: number }) {
  return (
    <View style={[styles.thumb, { width: size, height: size }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumbImg} />
      ) : (
        <Icon name="package-variant" size={size * 0.4} color={QUEST.muted} />
      )}
    </View>
  );
}

// ---------------------------------------------------------------------------
// Search Sheet (preserved — searches the user's catalog)
// ---------------------------------------------------------------------------
function SearchSheet({
  visible,
  onClose,
  query,
  onQueryChange,
  results,
  loading,
  onSelect,
}: {
  visible: boolean;
  onClose: () => void;
  query: string;
  onQueryChange: (q: string) => void;
  results: SearchResult[];
  loading: boolean;
  onSelect: (r: SearchResult) => void;
}) {
  const [selected, setSelected] = useState<SearchResult | null>(null);
  useEffect(() => {
    if (!visible) setSelected(null);
  }, [visible]);

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bsOverlay} onPress={onClose}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ width: '100%' }}>
          <Pressable style={[styles.bs, { maxHeight: '85%' }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.bsHandle} />
            <View style={styles.bsHeader}>
              <Text style={styles.bsTitle}>Search your catalog</Text>
              <View style={styles.bsSearchWrap}>
                <Icon name="magnify" size={18} color={QUEST.muted} />
                <TextInput
                  value={query}
                  onChangeText={onQueryChange}
                  placeholder="Search products in Anorha…"
                  placeholderTextColor={QUEST.muted}
                  style={styles.bsInput}
                  autoFocus
                  autoCorrect={false}
                  returnKeyType="search"
                />
              </View>
            </View>
            <ScrollView style={styles.bsResults} keyboardShouldPersistTaps="handled">
              {loading ? (
                <View style={{ padding: 24, alignItems: 'center' }}>
                  <ActivityIndicator color={QUEST.green} />
                </View>
              ) : results.length === 0 ? (
                <Text style={styles.bsEmpty}>{query ? 'No results' : 'Start typing to search'}</Text>
              ) : (
                results.map((r) => {
                  const isSel = selected?.id === r.id;
                  return (
                    <TouchableOpacity
                      key={r.id}
                      onPress={() => setSelected(r)}
                      style={[styles.bsRow, isSel && { backgroundColor: QUEST.greenSoft }]}
                    >
                      <View style={styles.bsRowIcon}>
                        {r.imageUrl ? (
                          <Image source={{ uri: r.imageUrl }} style={styles.thumbImg} />
                        ) : (
                          <Icon name="package-variant" size={15} color={isSel ? QUEST.greenD : QUEST.muted} />
                        )}
                      </View>
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text
                          style={[styles.bsRowName, { color: isSel ? QUEST.greenD : QUEST.ink }]}
                          numberOfLines={1}
                        >
                          {r.title}
                        </Text>
                        {(r.sku || r.price != null) && (
                          <Text style={styles.bsRowSub} numberOfLines={1}>
                            {r.sku ? `SKU ${r.sku}` : ''}
                            {r.price != null ? `${r.sku ? ' · ' : ''}$${r.price.toFixed(2)}` : ''}
                          </Text>
                        )}
                      </View>
                      {isSel && (
                        <View style={styles.bsCheck}>
                          <Icon name="check" size={12} color="#fff" />
                        </View>
                      )}
                    </TouchableOpacity>
                  );
                })
              )}
            </ScrollView>
            <View style={styles.bsFooter}>
              <QuestCTA
                label={
                  selected
                    ? `Link to ${selected.title.slice(0, 24)}${selected.title.length > 24 ? '…' : ''}`
                    : 'Select a product'
                }
                icon="check"
                color={selected ? QUEST.green : QUEST.greenSoft}
                dark={selected ? QUEST.greenD : QUEST.greenBorder}
                textColor={selected ? '#fff' : QUEST.greenD}
                disabled={!selected}
                onPress={() => selected && onSelect(selected)}
              />
            </View>
          </Pressable>
        </KeyboardAvoidingView>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// ItemSheet — tap an inventory row, see the item, act on it.
// One glanceable card: photo · name · sku/price · where it stands — then at
// most two buttons (Fix now / Ignore, or Restore). No dead ends.
// ---------------------------------------------------------------------------
function ItemSheet({
  item,
  isIgnored,
  openCase,
  onClose,
  onIgnore,
  onRestore,
  onFix,
}: {
  item: AnnotatedSuggestion;
  isIgnored: boolean;
  openCase: MatchCase | null;
  onClose: () => void;
  onIgnore: () => void;
  onRestore: () => void;
  onFix: (mc: MatchCase) => void;
}) {
  const p = item.platformProduct;
  const linked = item.resolved && item.action === 'LINK_EXISTING' && item.suggestedCanonicalProduct?.title;
  const priceNum = typeof p.price === 'number' ? p.price : Number(p.price);
  const status = isIgnored
    ? { icon: 'eye-off-outline' as const, text: 'Ignored — won’t be imported', color: RC.muted }
    : linked
      ? { icon: 'link-variant' as const, text: `Linked to ${item.suggestedCanonicalProduct!.title}`, color: RC.greenDark }
      : item.resolved && item.action === 'CREATE_NEW'
        ? { icon: 'plus-circle-outline' as const, text: 'Will be added as a new product', color: RC.greenDark }
        : openCase
          ? { icon: 'help-circle-outline' as const, text: 'Needs one quick decision', color: RC.orangeDark }
          : { icon: 'check' as const, text: 'Ready', color: RC.greenDark };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.bsOverlay} onPress={onClose}>
        <Pressable style={styles.itemSheet} onPress={(e) => e.stopPropagation()}>
          <View style={styles.bsHandle} />
          <View style={styles.itemSheetHead}>
            <View style={styles.itemSheetThumb}>
              {p.imageUrl ? (
                <Image source={{ uri: p.imageUrl }} style={styles.thumbImg} />
              ) : (
                <Icon name="package-variant" size={28} color={QUEST.muted} />
              )}
            </View>
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={styles.itemSheetTitle} numberOfLines={2}>{p.title || 'Untitled'}</Text>
              <Text style={styles.itemSheetMeta} numberOfLines={1}>
                {p.sku ? `SKU ${p.sku}` : 'no SKU'}
                {priceNum > 0 ? ` · $${priceNum.toFixed(2)}` : ''}
              </Text>
            </View>
          </View>

          <View style={styles.itemSheetStatus}>
            <Icon name={status.icon} size={16} color={status.color} />
            <Text style={[styles.itemSheetStatusText, { color: status.color }]} numberOfLines={2}>
              {status.text}
            </Text>
          </View>

          <View style={{ gap: 10, marginTop: 16 }}>
            {isIgnored ? (
              <TouchableOpacity activeOpacity={0.88} onPress={onRestore} style={styles.itemSheetPrimary}>
                <Icon name="restore" size={20} color="#fff" />
                <Text style={styles.itemSheetPrimaryText}>Restore this item</Text>
              </TouchableOpacity>
            ) : (
              <>
                {openCase && (
                  <TouchableOpacity activeOpacity={0.88} onPress={() => onFix(openCase)} style={styles.itemSheetPrimary}>
                    <Icon name="arrow-right" size={20} color="#fff" />
                    <Text style={styles.itemSheetPrimaryText}>Fix now — 1 quick question</Text>
                  </TouchableOpacity>
                )}
                <TouchableOpacity activeOpacity={0.85} onPress={onIgnore} style={styles.itemSheetSecondary}>
                  <Text style={styles.itemSheetSecondaryText}>Ignore — don’t import this item</Text>
                </TouchableOpacity>
              </>
            )}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Done Overlay (preserved — triggers the existing submitImport path)
// ---------------------------------------------------------------------------
function DoneOverlay({
  insets,
  linkedCount,
  skippedCount,
  onConfirm,
  onBack,
  isSubmitting,
}: {
  insets: { top: number; bottom: number };
  linkedCount: number;
  skippedCount: number;
  onConfirm: () => void;
  onBack: () => void;
  isSubmitting: boolean;
}) {
  return (
    <View style={[styles.doneOverlay, { paddingTop: insets.top + 80 }]}>
      <View style={styles.donePlant}>
        <Icon name="sprout-outline" size={32} color={QUEST.greenD} />
      </View>
      <Text style={styles.doneTitle}>All matched</Text>
      <Text style={styles.doneSub}>Everything is linked and ready. Confirm to apply across all platforms.</Text>
      <View style={styles.doneStats}>
        <View style={styles.doneStat}>
          <Text style={styles.doneStatValue}>{linkedCount}</Text>
          <Text style={styles.doneStatLabel}>LINKED</Text>
        </View>
        <View style={styles.doneStat}>
          <Text style={styles.doneStatValue}>{skippedCount}</Text>
          <Text style={styles.doneStatLabel}>SKIPPED</Text>
        </View>
      </View>
      <TouchableOpacity onPress={onConfirm} disabled={isSubmitting} style={styles.doneBtn}>
        {isSubmitting ? (
          <ActivityIndicator color="#fff" />
        ) : (
          <>
            <Icon name="arrow-right" size={16} color="#fff" />
            <Text style={styles.doneBtnText}>Confirm mapping</Text>
          </>
        )}
      </TouchableOpacity>
      <TouchableOpacity onPress={onBack} style={styles.doneBack}>
        <Icon name="arrow-left" size={14} color={QUEST.sub} />
        <Text style={styles.doneBackText}>Back to lobby</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#FFFFFF' },
  gearBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: QUEST.surface,
    borderWidth: 1,
    borderColor: QUEST.border,
    alignItems: 'center',
    justifyContent: 'center',
  },

  // Lobby
  lobbyHead: { paddingHorizontal: 20, paddingBottom: 12 },
  lobbyTitle: { fontSize: 18, fontFamily: QFONT.b, color: QUEST.ink, letterSpacing: -0.4 },
  lobbySub: { fontSize: 12, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 2 },
  lobbyScroll: { paddingHorizontal: 16, paddingBottom: 130 },
  lobbyHint: { fontSize: 14, fontWeight: '500', color: RC.muted, lineHeight: 20, marginBottom: 12, marginHorizontal: 2 },
  lobbySection: { fontSize: 11, fontWeight: '700', letterSpacing: 1.2, color: RC.faint, paddingTop: 16, paddingBottom: 8, paddingHorizontal: 4 },
  lobbyDeckHint: { fontSize: 12.5, fontWeight: '600', color: RC.faint, textAlign: 'center', paddingTop: 10, paddingHorizontal: 20, lineHeight: 18 },
  footerProgress: { paddingHorizontal: 4, paddingBottom: 10 },
  mlPeekThumb: { width: 22, height: 22, borderRadius: 6, backgroundColor: RC.surface2 },
  mlPeekTitle: { flex: 1, fontSize: 13, fontWeight: '600', color: RC.greenInk },
  mlPeekHow: { fontSize: 11, fontWeight: '700', color: RC.greenDark, fontVariant: ['tabular-nums'] },
  mlPeekLink: { fontSize: 13, fontWeight: '800', color: RC.greenDark, textDecorationLine: 'underline', marginTop: 2 },

  // Inventory / Ignored — search + selection header
  invSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    minHeight: 48,
    borderWidth: 1,
    borderColor: 'rgba(102,102,102,0.26)',
    borderRadius: 8,
    backgroundColor: '#FFF',
    paddingHorizontal: 12,
    marginHorizontal: 16,
    marginBottom: 10,
  },
  invSearchInput: { flex: 1, fontSize: 16, color: RC.ink, paddingVertical: 12 },
  selHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    minHeight: 48,
    paddingHorizontal: 16,
    marginHorizontal: 16,
    marginBottom: 10,
    borderRadius: 8,
    backgroundColor: RC.surface2,
  },
  selHeaderText: { flex: 1, fontSize: 15, fontWeight: '700', color: RC.ink },
  selHeaderLink: { fontSize: 14, fontWeight: '600', color: RC.greenDark },

  // ItemSheet
  itemSheet: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    paddingHorizontal: 18,
    paddingBottom: 34,
  },
  itemSheetHead: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 14 },
  itemSheetThumb: {
    width: 72,
    height: 72,
    borderRadius: 14,
    backgroundColor: RC.surface2,
    borderWidth: 1,
    borderColor: RC.line,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  itemSheetTitle: { fontSize: 17, fontWeight: '700', color: RC.ink, letterSpacing: -0.2 },
  itemSheetMeta: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 3 },
  itemSheetStatus: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginTop: 14,
    backgroundColor: RC.surface,
    borderWidth: 1,
    borderColor: RC.line,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  itemSheetStatusText: { flex: 1, fontSize: 14, fontWeight: '600' },
  itemSheetPrimary: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: RC.green,
    borderRadius: 12,
    paddingVertical: 14,
  },
  itemSheetPrimaryText: { fontSize: 16, fontWeight: '600', color: '#fff' },
  itemSheetSecondary: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#E5E5E5',
    borderRadius: 12,
    paddingVertical: 14,
  },
  itemSheetSecondaryText: { fontSize: 16, fontWeight: '600', color: '#71717A' },

  // Match-lobby v2 (issues / inventory / ignored)
  mlClearBanner: {
    backgroundColor: RC.greenSoft,
    borderWidth: 1,
    borderColor: RC.greenLine,
    borderRadius: 16,
    paddingVertical: 12,
    paddingHorizontal: 14,
    marginBottom: 4,
  },
  mlClearIcon: {
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: RC.greenLine,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mlClearText: { flex: 1, fontSize: 12.5, fontWeight: '700', color: RC.greenDark },
  mlList: { paddingHorizontal: 12, paddingTop: 2, paddingBottom: 130 },
  mlSep: { height: 1, backgroundColor: RC.line, marginLeft: 84, marginVertical: 2 },
  mlEmpty: { alignItems: 'center', paddingTop: 70, paddingHorizontal: 30 },
  mlEmptyTitle: { fontSize: 16, fontWeight: '700', color: RC.ink, marginTop: 12 },
  mlEmptySub: { fontSize: 13, fontWeight: '500', color: RC.muted, marginTop: 6, textAlign: 'center', lineHeight: 18 },

  // Center / scan / error
  centerBlock: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  centerTitle: { fontSize: 16, fontFamily: QFONT.b, color: QUEST.ink, marginTop: 16, textAlign: 'center' },
  centerSub: { fontSize: 13, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 6, textAlign: 'center' },
  retryBtn: { marginTop: 16, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 100, backgroundColor: QUEST.ink },
  retryBtnText: { color: '#fff', fontFamily: QFONT.b, fontSize: 13 },

  // Thumb
  thumb: {
    borderRadius: 12,
    backgroundColor: '#EFEAD8',
    borderWidth: 1,
    borderColor: QUEST.border,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  thumbImg: { width: '100%', height: '100%' },

  // Lesson — stack
  kicker: { fontSize: 10, fontFamily: QFONT.x, color: QUEST.sub, letterSpacing: 0.6, marginBottom: 8 },
  fromRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 4 },
  fromTitle: { fontSize: 15, fontFamily: QFONT.b, color: QUEST.ink, letterSpacing: -0.2 },
  fromSub: { fontSize: 12, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 3 },
  connector: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 12 },
  connectorLine: { flex: 1, height: 1, backgroundColor: QUEST.border },
  confPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: QUEST.yellowSoft,
    borderWidth: 1,
    borderColor: QUEST.yellowBorder,
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  confPillText: { fontSize: 11, fontFamily: QFONT.b, color: QUEST.yellowD },
  candidate: {
    backgroundColor: QUEST.yellowSoft,
    borderWidth: 1,
    borderColor: QUEST.yellowBorder,
    borderRadius: 16,
    padding: 14,
  },
  candidateHead: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 },
  changeLink: { fontSize: 11, fontFamily: QFONT.b, color: QUEST.ink, textDecorationLine: 'underline' },
  candidateTitle: { fontSize: 14, fontFamily: QFONT.b, color: QUEST.ink },
  candidateSub: { fontSize: 11.5, fontFamily: QFONT.m, color: QUEST.yellowD, marginTop: 2 },
  whyBox: {
    flexDirection: 'row',
    gap: 8,
    marginTop: 12,
    padding: 10,
    backgroundColor: QUEST.bg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: QUEST.borderDark,
    borderStyle: 'dashed',
  },
  whyText: { flex: 1, fontSize: 10.5, fontFamily: QFONT.m, color: QUEST.sub, lineHeight: 15 },
  noMatch: {
    alignItems: 'center',
    paddingVertical: 22,
    paddingHorizontal: 16,
    backgroundColor: QUEST.bg,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: QUEST.border,
  },
  noMatchTitle: { fontSize: 14, fontFamily: QFONT.b, color: QUEST.ink, marginTop: 10 },
  noMatchSub: { fontSize: 12, fontFamily: QFONT.m, color: QUEST.sub, textAlign: 'center', marginTop: 4, lineHeight: 16 },
  lessonActions: { flexDirection: 'row', gap: 10, marginTop: 18 },

  // Lesson — variants
  parentRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 14 },
  parentTitle: { fontSize: 15, fontFamily: QFONT.b, color: QUEST.ink, letterSpacing: -0.2 },
  parentSub: { fontSize: 11.5, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 2 },
  vRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    borderWidth: 1,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  vChip: {
    width: 26,
    height: 26,
    borderRadius: 8,
    backgroundColor: QUEST.surface,
    borderWidth: 1,
    borderColor: QUEST.borderDark,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vChipText: { fontSize: 11, fontFamily: QFONT.b, color: QUEST.ink },
  vTitle: { fontSize: 12, fontFamily: QFONT.b, color: QUEST.ink },
  vSku: { fontFamily: QFONT.m, color: QUEST.sub },
  vState: { fontSize: 10.5, fontFamily: QFONT.sb, marginTop: 2 },
  vMini: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: 'center',
    justifyContent: 'center',
  },
  vMiniGhost: { backgroundColor: QUEST.surface, borderWidth: 1, borderColor: QUEST.borderDark },

  // Floating bottom action bar fade (the BottomActionBar floats above it)
  fade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: 150 },

  // Bottom sheet (search)
  bsOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.35)', justifyContent: 'flex-end' },
  bs: { backgroundColor: QUEST.surface, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingBottom: 24 },
  bsHandle: { width: 40, height: 4, borderRadius: 2, backgroundColor: QUEST.border, alignSelf: 'center', marginTop: 10 },
  bsHeader: { paddingHorizontal: 18, paddingTop: 14 },
  bsTitle: { fontSize: 16, fontFamily: QFONT.b, color: QUEST.ink, marginBottom: 12, letterSpacing: -0.2 },
  bsSearchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: QUEST.bg,
    borderWidth: 1,
    borderColor: QUEST.border,
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  bsInput: { flex: 1, fontSize: 15, fontFamily: QFONT.m, color: QUEST.ink, padding: 0 },
  bsResults: { maxHeight: 320 },
  bsEmpty: { padding: 24, textAlign: 'center', fontSize: 13, fontFamily: QFONT.m, color: QUEST.sub },
  bsRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingVertical: 11 },
  bsRowIcon: {
    width: 34,
    height: 34,
    borderRadius: 9,
    backgroundColor: QUEST.bg,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  bsRowName: { fontSize: 14, fontFamily: QFONT.b },
  bsRowSub: { fontSize: 11, fontFamily: QFONT.m, color: QUEST.sub, marginTop: 2 },
  bsCheck: {
    width: 20,
    height: 20,
    borderRadius: 10,
    backgroundColor: QUEST.green,
    alignItems: 'center',
    justifyContent: 'center',
  },
  bsFooter: { paddingHorizontal: 18, paddingTop: 12, borderTopWidth: 1, borderTopColor: QUEST.border },

  // Done overlay
  doneOverlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: QUEST.bg,
    paddingHorizontal: 28,
    alignItems: 'center',
  },
  donePlant: {
    width: 76,
    height: 76,
    borderRadius: 22,
    backgroundColor: QUEST.greenSoft,
    borderWidth: 1,
    borderColor: QUEST.greenBorder,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 22,
  },
  doneTitle: { fontSize: 26, fontFamily: QFONT.b, color: QUEST.ink, marginBottom: 8, letterSpacing: -0.4 },
  doneSub: {
    fontSize: 14,
    fontFamily: QFONT.m,
    color: QUEST.sub,
    lineHeight: 20,
    marginBottom: 28,
    maxWidth: 280,
    textAlign: 'center',
  },
  doneStats: { flexDirection: 'row', width: '100%', marginBottom: 26 },
  doneStat: {
    flex: 1,
    backgroundColor: QUEST.surface,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: QUEST.border,
    padding: 14,
    marginHorizontal: 4,
  },
  doneStatValue: { fontSize: 22, fontFamily: QFONT.x, color: QUEST.ink, letterSpacing: -0.3 },
  doneStatLabel: { fontSize: 10, fontFamily: QFONT.b, color: QUEST.sub, marginTop: 4, letterSpacing: 0.6 },
  doneBtn: {
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    height: 52,
    borderRadius: 100,
    backgroundColor: QUEST.green,
  },
  doneBtnText: { fontSize: 15, fontFamily: QFONT.b, color: '#fff' },
  doneBack: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 16 },
  doneBackText: { fontSize: 13, fontFamily: QFONT.m, color: QUEST.sub },
});

export default MappingReviewScreen;
