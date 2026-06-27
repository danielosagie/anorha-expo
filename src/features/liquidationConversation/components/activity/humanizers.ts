// Plain-language humanizers shared by the activity cards, the review tray, and
// the legacy tool-step receipt. ONE source of truth so the no-internal-leak rule
// (never show a tool/vendor/model/cron name) is enforced in a single place.
//
// Two hard rules live here:
//  - the seller NEVER sees a raw identifier (snake_case / bare verb / enum);
//  - color encodes OLD-vs-NEW, never good-vs-bad (that decision is in ValueDiff).

import type { ActivityPayload, Routine, ValueChange } from '../../types';

// ── Tool-step humanizers (moved out of StreamingMessageBubble) ──────────

// Icon per tool family for the step rows (Slack/Gmail-style step list).
export const toolStepIcon = (tool: string): string => {
  const t = (tool || '').toLowerCase();
  if (t.includes('query') || t.startsWith('supabase')) return 'database-outline';
  if (t.includes('search') || t.includes('research')) return 'magnify';
  if (t.includes('price')) return 'tag-outline';
  if (t.includes('publish') || t.includes('delist') || t.includes('listing')) return 'storefront-outline';
  if (t.includes('text') || t.includes('sms')) return 'message-text-outline';
  if (t.includes('email')) return 'email-outline';
  if (t.includes('note')) return 'note-text-outline';
  if (t.includes('reminder')) return 'bell-outline';
  if (t.includes('campaign')) return 'rocket-launch-outline';
  if (t.includes('slow')) return 'trending-down';
  return 'cog-outline';
};

// Title-case a raw identifier as a last resort. The seller must NEVER see a
// snake_case (query_listings) OR camelCase (awaitingReview) name — it reads as
// plumbing — so split both before title-casing.
export const prettify = (s: string): string => {
  const cleaned = (s || '')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2') // camelCase -> two words
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
  if (!cleaned) return 'Done';
  return cleaned.charAt(0).toUpperCase() + cleaned.slice(1);
};

// A backend label that's a raw identifier (snake_case or a bare lowercase verb)
// shouldn't be shown as-is — humanize it from the tool family instead.
export const isRawIdent = (s?: string): boolean => !!s && (/[_]/.test(s) || /^[a-z]+$/.test(s.trim()));

// Present-tense phrase for what the agent is doing RIGHT NOW. Outcome, not tool.
export const toolActivePhrase = (tool: string): string => {
  const t = (tool || '').toLowerCase();
  if (t.includes('query') || t.startsWith('supabase')) return 'Checking your listings';
  if (t.includes('search') || t.includes('research')) return 'Researching the market';
  if (t.includes('price')) return 'Working out pricing';
  if (t.includes('delist')) return 'Taking items down';
  if (t.includes('publish') || t.includes('listing')) return 'Updating your listings';
  if (t.includes('flash') || t.includes('campaign')) return 'Setting up the campaign';
  if (t.includes('text') || t.includes('sms')) return 'Drafting a message';
  if (t.includes('email')) return 'Drafting an email';
  if (t.includes('note')) return 'Saving a note';
  if (t.includes('reminder')) return 'Setting a reminder';
  if (t.includes('slow')) return 'Finding slow movers';
  return 'Working on it';
};

// Past-tense receipt label for a finished step. Prefer a human label the backend
// already wrote; only humanize when it handed us a raw tool identifier.
export const toolDoneLabel = (tool: string, label?: string): string => {
  if (label && !isRawIdent(label)) return label;
  const t = (tool || '').toLowerCase();
  if (t.includes('query') || t.startsWith('supabase')) return 'Checked your listings';
  if (t.includes('search') || t.includes('research')) return 'Researched the market';
  if (t.includes('price')) return 'Reviewed pricing';
  if (t.includes('delist')) return 'Took items down';
  if (t.includes('publish') || t.includes('listing')) return 'Updated your listings';
  if (t.includes('flash') || t.includes('campaign')) return 'Launched the campaign';
  if (t.includes('text') || t.includes('sms')) return 'Sent a message';
  if (t.includes('email')) return 'Sent an email';
  if (t.includes('note')) return 'Saved a note';
  if (t.includes('reminder')) return 'Set a reminder';
  if (t.includes('slow')) return 'Found slow movers';
  return prettify(label || tool);
};

// ── Number / money formatting (tabular, no raw floats) ──────────────────

const groupThousands = (n: number): string => {
  const neg = n < 0;
  const abs = Math.abs(n);
  const fixed = Number.isInteger(abs) ? String(abs) : abs.toFixed(2);
  const [int, dec] = fixed.split('.');
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  return `${neg ? '-' : ''}${grouped}${dec ? `.${dec}` : ''}`;
};

// Keep the sign OUTSIDE the dollar mark ("-$50", not "$-50").
const withSign = (n: number): string => (n < 0 ? `-$${groupThousands(Math.abs(n))}` : `$${groupThousands(n)}`);

/** Format a money value. Numbers gain a $ + thousands; pre-formatted strings pass through. */
export const formatMoney = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return withSign(v);
  const s = String(v).trim();
  if (s.startsWith('$') || s.startsWith('-$')) return s;
  return /^-?\d/.test(s) ? withSign(Number(s.replace(/,/g, ''))) : s;
};

/** Format a count. Numbers gain thousands separators; strings pass through. */
export const formatCount = (v: string | number | null | undefined): string => {
  if (v === null || v === undefined || v === '') return '';
  if (typeof v === 'number') return groupThousands(v);
  return String(v);
};

/** Best-effort numeric extraction from a value or a formatted string ("$1,200" -> 1200). */
export const numericOf = (v: string | number | null | undefined): number | null => {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  const cleaned = String(v).replace(/[^0-9.\-]/g, '');
  if (!cleaned || cleaned === '-' || cleaned === '.') return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
};

/** Format the user-facing value for a change, by kind. */
export const formatChangeValue = (v: string | number | null | undefined, kind?: ValueChange['kind']): string => {
  if (kind === 'price') return formatMoney(v);
  if (kind === 'inventory') return formatCount(v);
  if (kind === 'status') return humanizeStatus(v);
  return v === null || v === undefined ? '' : String(v);
};

// ── Status enum humanizer (never show a raw enum) ───────────────────────

export const humanizeStatus = (raw: string | number | null | undefined): string => {
  const s = String(raw ?? '').trim().toLowerCase();
  if (!s) return '';
  if (s === 'draft' || s === 'unlisted') return 'Draft';
  if (s === 'active' || s === 'published' || s === 'live' || s === 'listed') return 'Live';
  if (s === 'ended' || s === 'delisted' || s === 'taken_down' || s === 'archived' || s === 'inactive') return 'Taken down';
  if (s === 'sold' || s === 'sold_out') return 'Sold';
  if (s === 'paused') return 'Paused';
  if (s === 'failed' || s === 'error') return 'Failed';
  if (s === 'syncing' || s === 'pending') return 'Syncing';
  return prettify(String(raw));
};

/** A status target that should read LOUD (red) rather than calm. */
export const isFailureStatus = (raw: string | number | null | undefined): boolean => {
  const s = String(raw ?? '').trim().toLowerCase();
  return s === 'failed' || s === 'error';
};

// ── Outcome title for a promoted value-change card ──────────────────────

const priceDirection = (changes: ValueChange[]): 'up' | 'down' | 'mixed' => {
  let down = 0;
  let up = 0;
  for (const c of changes) {
    let dir = c.direction;
    if (!dir) {
      const a = numericOf(c.from);
      const b = numericOf(c.to);
      dir = a !== null && b !== null ? (b < a ? 'down' : b > a ? 'up' : 'neutral') : 'neutral';
    }
    if (dir === 'down') down++;
    else if (dir === 'up') up++;
  }
  if (down && !up) return 'down';
  if (up && !down) return 'up';
  return 'mixed';
};

/** A warm, outcome-first title for a value change ("Lowered the price", "Put it live"). */
export const summarizeChangeTitle = (tool: string, changes: ValueChange[]): string => {
  if (!changes.length) return prettify(tool);
  const n = changes.length;
  const many = n > 1;
  const kinds = new Set(changes.map((c) => c.kind || 'text'));
  if (kinds.size === 1) {
    const kind = changes[0].kind;
    if (kind === 'price') {
      const dir = priceDirection(changes);
      if (dir === 'down') return many ? `Lowered ${n} prices` : 'Lowered the price';
      if (dir === 'up') return many ? `Raised ${n} prices` : 'Raised the price';
      return many ? `Updated ${n} prices` : 'Updated the price';
    }
    if (kind === 'inventory') return many ? `Updated ${n} stock counts` : 'Updated inventory';
    if (kind === 'status') {
      const to = humanizeStatus(changes[0].to).toLowerCase();
      if (to === 'live') return many ? `Put ${n} live` : 'Put it live';
      if (to === 'taken down') return many ? `Took ${n} down` : 'Took it down';
      if (to === 'sold') return many ? `Marked ${n} sold` : 'Marked it sold';
      return many ? `Updated ${n} statuses` : 'Updated status';
    }
  }
  return many ? `Updated ${n} details` : 'Updated the listing';
};

// ── Sales-channel display names (never render a raw channel key) ─────────

const CHANNEL_NAMES: Record<string, string> = {
  ebay: 'eBay',
  shopify: 'Shopify',
  shopify_pos: 'Shopify POS',
  amazon: 'Amazon',
  etsy: 'Etsy',
  facebook: 'Facebook',
  facebook_marketplace: 'Facebook',
  square: 'Square',
  clover: 'Clover',
  whatnot: 'Whatnot',
  depop: 'Depop',
  poshmark: 'Poshmark',
  mercari: 'Mercari',
  grailed: 'Grailed',
  woocommerce: 'WooCommerce',
};

/** A seller-facing channel name. Known keys map to brand casing; anything else is humanized. */
export const humanizeChannel = (raw: string): string => {
  const key = String(raw ?? '').trim().toLowerCase();
  return CHANNEL_NAMES[key] || prettify(String(raw));
};

// ── Routine cadence ("Every day · 9:00 AM") — derived CLIENT-SIDE ────────

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export const humanizeCadence = (cadence: Routine['cadence']): string => {
  if (!cadence) return '';
  const at = cadence.atLocal ? ` · ${cadence.atLocal}` : '';
  switch (cadence.type) {
    case 'daily':
      return `Every day${at}`;
    case 'weekly': {
      const day = typeof cadence.weekday === 'number' ? WEEKDAYS[cadence.weekday % 7] : null;
      return day ? `Every ${day}${at}` : `Every week${at}`;
    }
    case 'hourly':
      return cadence.everyHours && cadence.everyHours > 1 ? `Every ${cadence.everyHours} hours` : 'Every hour';
    case 'interval':
      return cadence.everyHours ? `Every ${cadence.everyHours} hours` : 'On a schedule';
    default:
      return 'On a schedule';
  }
};

// ── Card icon glyphs (MaterialCommunityIcons) ───────────────────────────

/** Glyph for a single change kind — used on preview rows. */
export const changeKindGlyph = (kind?: ValueChange['kind']): string => {
  if (kind === 'price') return 'tag-outline';
  if (kind === 'inventory') return 'package-variant';
  if (kind === 'status') return 'storefront-outline';
  return 'pencil-outline';
};

/** The leading icon-tile glyph for a whole activity card. */
export const activityGlyph = (payload: ActivityPayload): string => {
  if (payload.status === 'failed') return 'alert-circle-outline';
  if (payload.status === 'syncing') return 'sync';
  switch (payload.kind) {
    case 'routine':
      return 'autorenew';
    case 'reminder':
      return 'bell-outline';
    case 'publish':
      return 'storefront-outline';
    case 'value-change': {
      const first = payload.changes?.[0];
      return changeKindGlyph(first?.kind);
    }
    case 'tool-run':
    default:
      return 'magnify';
  }
};
