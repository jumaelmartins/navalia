# Navalia Design System

Reference for all UI tasks. Read this before building any screen.

---

## 1. Color Palette

### Brand

| Token | Hex | Usage |
|---|---|---|
| Brass (primary) | `#C4964A` | CTA buttons, key stat numbers, focus rings, accent on headers |
| Brass hover | `#B0843C` | Hover state for primary buttons only |

### Light Surface (Dashboard — default `:root`)

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#FBF9F5` | Page background |
| `--foreground` | `#1C1917` | Body text, headings |
| `--card` | `#FFFFFF` | Card surfaces, panels |
| `--card-foreground` | `#1C1917` | Text inside cards |
| `--muted` | `#F0ECE4` | Subtle backgrounds, table stripes |
| `--muted-foreground` | `#78716C` | Secondary labels, placeholder text |
| `--border` | `#E7E0D5` | Dividers, input borders |
| `--primary` | `#C4964A` | Primary buttons, active states |
| `--primary-foreground` | `#FFFFFF` | Text on primary buttons |
| `--destructive` | `#A34D42` | Error states, destructive actions |

### Dark Surface (Marketing / Public / Auth — `.theme-dark`)

| Token | Hex | Usage |
|---|---|---|
| `--background` | `#171412` | Page background |
| `--foreground` | `#F5F1EA` | Body text, headings |
| `--card` | `#211D19` | Elevated card surfaces |
| `--muted` | `#2A2520` | Subtle backgrounds |
| `--muted-foreground` | `#9C8E7E` | Secondary labels |
| `--border` | `#332D27` | Dividers, borders |
| `--primary` | `#C4964A` | Primary buttons (brass is unchanged) |
| `--primary-foreground` | `#0F0D0B` | Text on primary buttons (dark) |

### Appointment Status Tokens

These map directly to `AppointmentStatus` enum values. Use these tokens for badge coloring — do not invent custom colors.

| Status | Background token | Foreground token | Hex (bg) |
|---|---|---|---|
| `CONFIRMED` | `--status-confirmed` | `--status-confirmed-fg` | `#C4964A` |
| `PENDING` | `--status-pending` | `--status-pending-fg` | `#78716C` |
| `COMPLETED` | `--status-completed` | `--status-completed-fg` | `#4A7C59` |
| `CANCELLED` | `--status-cancelled` | `--status-cancelled-fg` | `#A34D42` |
| `NO_SHOW` | `--status-no-show` | `--status-no-show-fg` | `#B07A3C` |

Access via Tailwind: `bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]`.

**Dark theme adjustments**: In `.theme-dark`, `--destructive` and `--status-cancelled` use `#C4645A` (brightened from light-scope `#A34D42`) to ensure sufficient contrast and legibility on charcoal backgrounds.

---

## 2. Typography

### Fonts

| Variable | Font | Weights | Use |
|---|---|---|---|
| `--font-display` / `font-display` | Fraunces (serif) | 400, 600 | h1, h2, hero headlines, stat numbers |
| `--font-sans` / `font-sans` | Inter | 400, 500, 600 | Body, labels, UI copy, tables |

Both are loaded via `next/font/google` in `src/app/layout.tsx`.

`h1` and `h2` inherit `font-family: var(--font-display)` via the global base layer. All other elements default to Inter via `body { font-family: var(--font-sans) }`.

### Type Scale

| Element | Class | Size | Weight | Font |
|---|---|---|---|---|
| Hero headline | `.text-hero` | `4xl–6xl` (responsive) | `font-semibold` | Fraunces |
| Page h1 | `h1` | `text-3xl` | `font-semibold` | Fraunces |
| Section h2 | `h2` | `text-2xl` | `font-semibold` | Fraunces |
| Stat number | `.font-display text-4xl` | `text-4xl` | `font-semibold` | Fraunces |
| Body | (default) | `text-base` | `font-normal` | Inter |
| Label / caption | `.text-sm` | `text-sm` | `font-medium` | Inter |
| Table cell | `.text-sm` | `text-sm` | `font-normal` | Inter |
| Badge | `.text-xs` | `text-xs` | `font-medium` | Inter |

---

## 3. Spacing Rhythm

Base unit: `4px` (Tailwind's default `space-1 = 4px`).

| Name | Value | Use |
|---|---|---|
| `space-1` / `4px` | Micro gap | Icon-to-label, inline tag spacing |
| `space-2` / `8px` | Tight | Button padding horizontal, badge padding |
| `space-3` / `12px` | Compact | Form field vertical spacing, card inner gap |
| `space-4` / `16px` | Default | Card padding, list item height |
| `space-6` / `24px` | Loose | Section padding, column gap |
| `space-8` / `32px` | Section | Between major page sections |
| `space-12` / `48px` | Page | Top/bottom page padding |

Always prefer multiples of 4. Do not use arbitrary pixel values for spacing without a design reason.

---

## 4. Border Radius

`--radius: 0.5rem` (8px base).

| Token | Value | Use |
|---|---|---|
| `rounded-sm` | `~5px` | Badges, chips |
| `rounded-md` | `~6px` | Inputs, small buttons |
| `rounded-lg` | `8px` (base) | Cards, dialogs, popovers |
| `rounded-xl` | `~11px` | Large cards, modals |

Do not use `rounded-full` for buttons. Use it only for avatar images and circular icon buttons where semantically appropriate.

---

## 5. Shadows

Shadows must be warm-tinted and subtle. Maximum allowed: `shadow-md`.

| Class | Use |
|---|---|
| `shadow-sm` | Cards at rest, inputs |
| `shadow-md` | Elevated dialogs, dropdowns — maximum depth |

Do not use: `shadow-lg`, `shadow-xl`, `shadow-2xl`, or colored glows.

---

## 6. Component Conventions

### Buttons

```
Primary:   bg-primary text-primary-foreground hover:bg-primary-hover  → brass fill, use sparingly (1 per screen section)
Secondary: bg-secondary text-secondary-foreground  → muted warm fill
Outline:   border-border bg-background             → for non-destructive tertiary actions
Ghost:     hover:bg-muted                          → for icon buttons and table row actions
Destructive: bg-destructive/10 text-destructive   → always pair with a confirmation dialog
```

- Size: use `default` (h-8) for most UI, `sm` for table row actions, `lg` for CTA hero buttons.
- Do not use `rounded-full` for buttons. All buttons use `rounded-lg` (the default).
- The brass primary button is reserved for the single most important action on a page (e.g., "Nova reserva").
- Primary button hover state: `hover:bg-primary-hover` (#B0843C).

### Cards

```tsx
<Card className="shadow-sm">
  <CardHeader>
    <CardTitle>Title</CardTitle>          {/* Fraunces via h-element inheritance */}
    <CardDescription>Subtitle</CardDescription>
  </CardHeader>
  <CardContent>...</CardContent>
  <CardFooter>...</CardFooter>
</Card>
```

- Cards always use `bg-card shadow-sm border border-border`.
- No nested card-inside-card pattern.
- Stat cards (KPI panels): put the number in `<span className="font-display text-4xl font-semibold text-primary">`.

### Tables

```tsx
<Table>
  <TableHeader>
    <TableRow>
      <TableHead>Column</TableHead>
    </TableRow>
  </TableHeader>
  <TableBody>
    <TableRow className="hover:bg-muted/50">
      <TableCell>Value</TableCell>
    </TableRow>
  </TableBody>
</Table>
```

- Header cells: `text-xs font-medium uppercase text-muted-foreground tracking-wider`.
- Body rows: `hover:bg-muted/50 transition-colors`.
- Row actions (edit/delete): Ghost button variant, `size="icon-sm"`, shown on row hover only via group-hover.

### Empty States

```tsx
<div className="flex flex-col items-center justify-center py-12 text-center">
  <SomeIcon className="size-10 text-muted-foreground/40 mb-3" />
  <p className="text-sm font-medium text-muted-foreground">No items yet</p>
  <p className="text-xs text-muted-foreground/70 mt-1">...</p>
  <Button variant="default" size="sm" className="mt-4">Primary action</Button>
</div>
```

- Use a Lucide icon, muted at 40% opacity.
- One sentence label + one optional sub-sentence.
- Optional single CTA (primary variant).

### Status Badges

```tsx
// AppointmentStatus → badge style
const STATUS_STYLES: Record<AppointmentStatus, string> = {
  CONFIRMED: "bg-[var(--status-confirmed)] text-[var(--status-confirmed-fg)]",
  PENDING:   "bg-[var(--status-pending)]   text-[var(--status-pending-fg)]",
  COMPLETED: "bg-[var(--status-completed)] text-[var(--status-completed-fg)]",
  CANCELLED: "bg-[var(--status-cancelled)] text-[var(--status-cancelled-fg)]",
  NO_SHOW:   "bg-[var(--status-no-show)]   text-[var(--status-no-show-fg)]",
}

<Badge className={cn("text-xs font-medium", STATUS_STYLES[status])}>
  {STATUS_LABELS[status]}
</Badge>
```

- Badge text: Portuguese labels (`Confirmado`, `Pendente`, `Concluído`, `Cancelado`, `Não compareceu`).
- Do not map statuses to generic Tailwind color classes — always use the status token.

### Forms

- Inputs: `border-input bg-background` at rest, `ring-primary/50` on focus.
- Labels: `text-sm font-medium text-foreground` — always visible, never placeholder-only.
- Error messages: `text-xs text-destructive mt-1`.
- Field spacing: `space-y-4` between fields, `space-y-1.5` between label and input.

---

## 7. Theme Scope Usage

```tsx
// Dashboard layout (default light) — no extra class needed
<html className={`${inter.variable} ${fraunces.variable}`}>...</html>

// Marketing / public / auth layouts — apply dark theme
<html className={`${inter.variable} ${fraunces.variable} theme-dark`}>...</html>
```

shadcn component `dark:` utilities activate automatically when `.theme-dark` is present on an ancestor (wired via `@custom-variant dark (&:is(.theme-dark *))`).

---

## 8. Anti-Patterns (FORBIDDEN)

Never use these — they produce generic AI-slop aesthetics:

| Pattern | Reason |
|---|---|
| `bg-gradient-to-r from-blue-500 to-purple-600` | Off-brand gradient — purple is not in the palette |
| Any purple/violet color | Not in Navalia's palette |
| Glassmorphism (`backdrop-blur`, `bg-white/10`) | Trendy, not timeless |
| Neon glows or colored box-shadows | No depth context, not premium |
| Emoji in UI copy | Never in button text, headings, or data labels |
| `rounded-full` on buttons | Use `rounded-lg`; pill buttons are not the brand shape |
| `shadow-lg` and above | Too heavy; maximum is `shadow-md` |
| Generic loading spinners with blue | Use `<Skeleton>` with warm muted background |
| Multiple primary (brass) buttons per section | Brass is reserved for ONE primary action per screen section |
| Hardcoded hex colors in components | Always use CSS token variables |
