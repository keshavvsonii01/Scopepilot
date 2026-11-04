---
name: Technical Editorial Intelligence
colors:
  surface: '#fbf9f3'
  surface-dim: '#dcdad4'
  surface-bright: '#fbf9f3'
  surface-container-lowest: '#ffffff'
  surface-container-low: '#f5f3ed'
  surface-container: '#f0eee8'
  surface-container-high: '#eae8e2'
  surface-container-highest: '#e4e2dc'
  on-surface: '#1b1c18'
  on-surface-variant: '#434846'
  inverse-surface: '#30312d'
  inverse-on-surface: '#f3f1eb'
  outline: '#747876'
  outline-variant: '#c4c7c5'
  surface-tint: '#5c5f5d'
  primary: '#000000'
  on-primary: '#ffffff'
  primary-container: '#191c1b'
  on-primary-container: '#828483'
  inverse-primary: '#c5c7c5'
  secondary: '#196e00'
  on-secondary: '#ffffff'
  secondary-container: '#8afd67'
  on-secondary-container: '#1b7400'
  tertiary: '#000000'
  on-tertiary: '#ffffff'
  tertiary-container: '#0e1c2d'
  on-tertiary-container: '#77859a'
  error: '#ba1a1a'
  on-error: '#ffffff'
  error-container: '#ffdad6'
  on-error-container: '#93000a'
  primary-fixed: '#e1e3e1'
  primary-fixed-dim: '#c5c7c5'
  on-primary-fixed: '#191c1b'
  on-primary-fixed-variant: '#444746'
  secondary-fixed: '#8afd67'
  secondary-fixed-dim: '#6edf4d'
  on-secondary-fixed: '#032100'
  on-secondary-fixed-variant: '#105300'
  tertiary-fixed: '#d5e3fb'
  tertiary-fixed-dim: '#b9c7df'
  on-tertiary-fixed: '#0e1c2d'
  on-tertiary-fixed-variant: '#3a485b'
  background: '#fbf9f3'
  on-background: '#1b1c18'
  surface-variant: '#e4e2dc'
typography:
  display-xl:
    fontFamily: Space Grotesk
    fontSize: 56px
    fontWeight: '700'
    lineHeight: 60px
    letterSpacing: -0.04em
  display-xl-mobile:
    fontFamily: Space Grotesk
    fontSize: 38px
    fontWeight: '700'
    lineHeight: 42px
    letterSpacing: -0.03em
  headline-lg:
    fontFamily: Space Grotesk
    fontSize: 36px
    fontWeight: '600'
    lineHeight: 40px
    letterSpacing: -0.03em
  headline-lg-mobile:
    fontFamily: Space Grotesk
    fontSize: 28px
    fontWeight: '600'
    lineHeight: 32px
    letterSpacing: -0.02em
  headline-md:
    fontFamily: Space Grotesk
    fontSize: 24px
    fontWeight: '600'
    lineHeight: 28px
    letterSpacing: -0.02em
  headline-sm:
    fontFamily: Space Grotesk
    fontSize: 18px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.01em
  body-lg:
    fontFamily: Inter
    fontSize: 17px
    fontWeight: '400'
    lineHeight: 26px
    letterSpacing: -0.01em
  body-md:
    fontFamily: Inter
    fontSize: 14px
    fontWeight: '400'
    lineHeight: 22px
    letterSpacing: 0em
  body-sm:
    fontFamily: Inter
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
  mono-metric:
    fontFamily: JetBrains Mono
    fontSize: 20px
    fontWeight: '600'
    lineHeight: 24px
    letterSpacing: -0.02em
  mono-label:
    fontFamily: JetBrains Mono
    fontSize: 11px
    fontWeight: '500'
    lineHeight: 14px
    letterSpacing: 0.06em
  mono-code:
    fontFamily: JetBrains Mono
    fontSize: 12px
    fontWeight: '400'
    lineHeight: 18px
    letterSpacing: 0em
rounded:
  sm: 0.125rem
  DEFAULT: 0.25rem
  md: 0.375rem
  lg: 0.5rem
  xl: 0.75rem
  full: 9999px
spacing:
  gutter: 1.5rem
  gutter-sm: 1rem
  gutter-lg: 2.5rem
  margin: 2rem
  margin-sm: 1rem
  margin-lg: 4rem
  space-xs: 0.25rem
  space-sm: 0.5rem
  space-md: 1rem
  space-lg: 1.5rem
  space-xl: 2.5rem
  space-2xl: 4rem
---

## Brand & Style

This design system establishes an editorial, analytical aesthetic tailored for sophisticated digital agencies, freelance systems engineers, and technical estimators. It rejects generic SaaS decoration, eliminating blurred gradients, faux-glass sheen, and anthropomorphic AI sparkles. Instead, it draws from brutalist-refined publication design, high-density telemetry dashboards, and precision architectural blueprints.

The visual tone communicates sharp competence, methodical diagnostics, and computational authority. High-contrast typography on warm, archival paper creates a tactile, documentarian canvas, punctuated by tactical neon accents that signal active analysis and critical technical debt. Asymmetric structures, hairline dividers, precision crosshairs (`+`), and monospaced diagnostic markers frame client intelligence not as marketing copy, but as audit-grade operational truth.

## Colors

The palette establishes an intentional high-contrast baseline centered around a foundational archival sheet and ink hierarchy:

- **Primary Canvas (`#F2F0EA`)**: Warm paper ground that serves as the dominant canvas, preventing sterile blue-white screen fatigue.
- **Deep Ink (`#171A19`)**: Primary text, master borders, and contextual inverted console blocks.
- **Acid Lime (`#8CFF69`)**: A functional electric accent reserved strictly for active generation states, positive telemetry, high-confidence scores, and critical execution CTAs.
- **Electric Blue Tint (`#D9E7FF`)**: Secondary diagnostic ground for selection bounds, inspection framing, and informational tokens.
- **Attention Amber (`#E8A45D`)**: Dedicated status alert tone used for technical debt warnings, scope creep indicators, and timeline risks.
- **Muted Charcoal (`#525754`) & Technical Slate (`#7A827E`)**: Structural body copy, unit annotations, and inactive state indicators.
- **Structural Lines (`#D8D4CA` on paper, `#2A2E2C` on dark ink)**: Hairline grid delineation, tabular cells, and layout registration lines.

## Typography

The typographic hierarchy orchestrates tight editorial display weight with rigorous data legibility:

- **Headlines (`Space Grotesk`)**: Scaled with compressed vertical tracking and negative letter-spacing. Display headlines must feature editorial scale, sitting heavy on the canvas to lead audit narratives.
- **Body (`Inter`)**: Applied for narrative summaries, contextual client analyses, and long-form scope descriptions. Line-heights are calculated to preserve editorial pacing across multi-paragraph documents.
- **Technical & Metric Layer (`JetBrains Mono`)**: Handles all UI controls, category tags, system timestamps, confidence values, telemetry labels, and code structures. Monospaced labels should default to uppercase with tracking expanded to `+0.06em` to maintain legibility at sub-12px thresholds.

## Layout & Spacing

Layouts use an asymmetric 12-column grid balanced by unyielding structural alignment:

- **Asymmetry**: Standard page compositions favor wide diagnostic viewports (e.g., an 8-column primary inspection document paired with a 4-column contextual parameter panel) or an offset 3/9 distribution.
- **Editorial Grids**: Panels align cleanly along shared structural hair lines. Layout blocks must span whole column intervals, avoiding arbitrary fluid margins.
- **Responsive Adaptations**:
  - **Desktop (1280px+)**: 12-column grid, 4rem section margins, 2.5rem gutters, persistent lateral diagnostic inspectors.
  - **Tablet (768px – 1279px)**: 8-column layout, 2rem margins, 1.5rem gutters; secondary panels collapse beneath primary analytical sheets.
  - **Mobile (< 768px)**: 4-column fluid stack, 1rem margins, 1rem gutters; technical labels remain docked in tight, horizontal strip configurations.

## Elevation & Depth

This system avoids ambient floating shadows and blur-filtered depth. Elevation is communicated mechanically through high-contrast boundary definition, physical edge offsets, and chromatic inversion:

- **Level 0 (Base Canvas)**: Warm paper ground (`#F2F0EA`). All structural divisions marked with a clean 1px hairline border (`#D8D4CA`).
- **Level 1 (Extruded & Contained Surfaces)**: Cards and inspection plates sit directly on the ground or elevate via flat hard offsets: `border: 1px solid #171A19` paired with an un-blurred shadow `box-shadow: 2px 2px 0px #171A19`.
- **Level 2 (Inverted Consoles & Overlays)**: System sidebars, terminal consoles, and active scopes invert the background to deep ink (`#171A19`), framed with internal slate borders (`#2A2E2C`) to create authoritative structural depth.
- **Diagnostic Inspection Layer**: Active focus rings, marquee selection bounds, and dynamic inspection targets render in a 1px solid Acid Lime (`#8CFF69`) border with zero shadow or blur.

## Shapes

The geometric personality centers on crisp, architectural edges subtly tempered with precise micro-radii:

- **Baseline Geometry**: Controls, badges, input boundaries, and cards strictly adopt `0.25rem` (4px) corner radii. This prevents the harshness of raw brutalism while sustaining precise technical discipline.
- **Sheet Containers (`rounded-lg`)**: Larger workspace sheets and top-level modal panels utilize `0.5rem` (8px).
- **Zero-Radius Elements**: Hairline tabular cells, technical status ribbons, visual inspection wireframes, crosshair alignments, and terminal windows retain absolute sharp corners (`0px`). Pill shapes (`rounded-full`) are strictly forbidden.

## Components

### Buttons & Interactive Controls
- **Primary CTA**: Deep ink background (`#171A19`), text in warm paper (`#F2F0EA`), 4px border-radius, font set to JetBrains Mono uppercase (11px/600). Hover triggers a solid fill swap to Acid Lime (`#8CFF69`) with deep ink text.
- **Secondary Action**: Transparent background, 1px hairline border (`#171A19`), deep ink text. Hover state yields a solid 2px offset hard shadow (`2px 2px 0px #171A19`).
- **Telemetry Action**: Flat Acid Lime (`#8CFF69`) background, deep ink text (`#171A19`), used exclusively for final scope generation or real-time crawling.

### Badges, Chips & Status Markers
- **Inspection Chips**: JetBrains Mono 10px uppercase, padding `2px 6px`, 4px radius, framed by a 1px border.
  - Active / Validated: Light green tint (`#8CFF69` at 15% opacity), text `#171A19`, border `#8CFF69`.
  - Attention / Debt: Muted amber tint (`#E8A45D` at 15% opacity), text `#171A19`, border `#E8A45D`.
  - Informational: Tint `#D9E7FF`, text `#171A19`, border `#171A19`.

### Input Fields & Selectors
- Flat paper background, 1px border (`#D8D4CA`), 4px radius. 
- Input text rendered in Inter 14px; field labels in JetBrains Mono 11px uppercase (`#525754`).
- Focus state: Replaces border with 1px solid deep ink (`#171A19`) and an immediate 1px outer ring in Acid Lime (`#8CFF69`).

### Selection Cards & Proposal Modules
- Editorial card structures: 1px border (`#D8D4CA`), background `#F2F0EA` or pure white container plates.
- Top-level cards feature a dedicated "metadata header bar" containing an uppercase category tag on the left and a technical ID or crosshair (`+`) marker on the right, separated from the content body by a horizontal 1px hairline.
- Selected or active inspection state: Solid 1px border `#171A19` with a hard drop shadow (`3px 3px 0px #171A19`).

### Lists & Data Matrices
- Structured as dense tabular registers. Rows separated by 1px hairline `#D8D4CA`.
- Row hover triggers an electric blue tint (`#D9E7FF` at 40% fill) or inverted deep ink state on telemetry tables. Monospaced numeric alignment on all metric columns.

### Specialized System Elements
- **Crosshair Anchor (`+`)**: Monospaced decorative registration marks positioned at card corners or asymmetric grid intersections.
- **Telemetry Scan Bar**: A high-density 2px Acid Lime rule that anchors real-time AI code analysis or URL scraping tasks.