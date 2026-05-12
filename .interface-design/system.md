# Design System — Anorha Liquidation Console

## Direction

- **Personality:** Calm control — precise, trustworthy, focused. Not friendly-dashboard or playful chat.
- **Signature:** Conversation-first console. The thread (agent message + Approve/Reject) is the main object; insight card and metrics answer "should I approve?"; config supports "at what pace?"

## Depth

- **Strategy:** Surface color shifts + very subtle borders only. No heavy shadows.
- **Borders:** Default `rgba(0,0,0,0.07)`; subtle `rgba(0,0,0,0.05)`; emphasis (e.g. selected tab) solid or higher contrast.
- **Surfaces:** Base canvas → elevated cards → inset controls. Each step is a whisper-quiet shift.

## Spacing

- **Base:** 8px
- **Scale:** 8, 12, 16, 24, 32
- Use symmetrical padding; every padding/margin from this scale.

## Palette (tokens)

- **Canvas:** `#f8fafb`
- **Surface:** `#ffffff`
- **Surface inset:** `#f1f5f9` (inputs, unselected pills)
- **Ink (primary):** `#111827`
- **Ink secondary:** `#4b5563`
- **Ink tertiary / muted:** `#6b7280`, `#9ca3af`
- **Accent primary (yellow):** `#eab308` (buttons, selected underline, borders); tint `#fef9c3` (selected card, date pill, insight outer)
- **Accent success:** green (e.g. `#16a34a`, tint `#f0fdf4`, border `rgba(22,163,74,0.35)`) — Approve only
- **Accent review:** amber tint for recommendation blocks (e.g. `#fefce8`, border `#fef08a`)

## Radius

- **Small:** 6px (buttons, inputs)
- **Medium:** 12px (cards, bubbles)
- **Large:** 16px (modals, large containers); 18px for circular day pills; 24px for input wrapper

## Typography

- **Primary:** Strong weight, high contrast — headlines, key metrics, selected state.
- **Secondary:** Supporting copy, labels.
- **Tertiary:** Metadata, timestamps.
- **Muted:** Placeholders, hints. All four levels used consistently.

## Key patterns

### Header
- Same surface as content or white; separation via single subtle border only. Nav row padding 8px 16px.

### Campaign selector cards
- Light mode. Selected: yellow tint `#fef9c3` + yellow border `#eab308`; text ink. Unselected: white, default border. "New": dashed border, muted text. Padding 12px; gap 12px.

### Tab row
- Selected: ink text + 2px yellow underline `#eab308`. Unselected: muted. Border under row: border-subtle. Padding 12px vertical.

### Insight card
- Outer: yellow tint `#fefce8`, border `rgba(234,179,8,0.3)`, 12px radius, 16px padding. Inner content card: white, 12px radius, 16px padding. Headline primary; description secondary; "Updated …" tertiary. Metrics: two-column, subtle divider; labels tertiary, values primary. Recommendation block: semantic amber tint and border. Footer "Sources": muted.

### Date timeline
- Selected: pill (borderRadius 20px), yellow fill `#fef9c3`, yellow border `#eab308`; text ink. Unselected: muted text, no fill. Gap 12px; padding 12px 16px.

### Chat input
- Control token (surface-inset), border from system, placeholder muted. Send button: yellow accent `#eab308`. Padding 12px; border-top subtle.

### Message bubbles
- Assistant: elevated surface, soft border, avatar container subtle; user: ink background. Timestamps tertiary. Approval row: Reject/Approve semantic colors (red-50/green-50), consistent button padding from scale.

### Config: Campaign Controls / Inventory Strategy
- Light mode. Section title primary; card elevated surface, default border, 16px padding. Segmented control: inset track, selected segment elevated. Item row: 12px padding; product name primary, SKU/units secondary, price primary/secondary; velocity pill semantic tint.
