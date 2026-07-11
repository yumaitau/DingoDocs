---
name: DingoDocs
description: Calm operational clarity for professional security assessments
colors:
  harbour-50: "oklch(0.975 0.012 241)"
  harbour-100: "oklch(0.944 0.027 241)"
  harbour-500: "oklch(0.575 0.142 245)"
  harbour-600: "oklch(0.495 0.14 247)"
  harbour-700: "oklch(0.415 0.119 248)"
  paper: "oklch(0.995 0.003 245)"
  mist: "oklch(0.972 0.008 245)"
  mist-strong: "oklch(0.938 0.014 245)"
  slate-950: "oklch(0.205 0.025 249)"
  slate-700: "oklch(0.393 0.032 249)"
  slate-500: "oklch(0.56 0.025 249)"
  border: "oklch(0.893 0.016 245)"
typography:
  headline:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1.5rem"
    fontWeight: 600
    lineHeight: 1.25
    letterSpacing: "-0.02em"
  title:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "1rem"
    fontWeight: 600
    lineHeight: 1.5
  body:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.875rem"
    fontWeight: 400
    lineHeight: 1.5
  label:
    fontFamily: "Geist, ui-sans-serif, system-ui, sans-serif"
    fontSize: "0.75rem"
    fontWeight: 500
    lineHeight: 1.25
rounded:
  sm: "6px"
  md: "10px"
  lg: "14px"
spacing:
  xs: "4px"
  sm: "8px"
  md: "16px"
  lg: "24px"
  xl: "32px"
components:
  button-primary:
    backgroundColor: "{colors.harbour-600}"
    textColor: "{colors.paper}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "36px"
  button-secondary:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.slate-700}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "36px"
  input:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.slate-950}"
    rounded: "{rounded.sm}"
    padding: "8px 12px"
    height: "44px"
---

# Design System: DingoDocs

## 1. Overview

**Creative North Star: "The Quiet Operations Room"**

DingoDocs feels like a well-run assessment room in daylight: focused, calm, and immediately legible. Cool tinted neutrals support long working sessions; Harbour Blue marks action, focus, and selection without washing the interface in brand colour. Density rises where comparison matters and opens up where a user must decide.

Interaction follows the responsiveness of Linear and Raycast, GitHub and Stripe's information hierarchy, and Notion's composed document handling. Motion communicates state only. Mobile layouts preserve complete workflows through structural reflow, horizontal tab scrolling, and deliberate table overflow.

**Key Characteristics:**

- Calm, precise, and operational
- Dense where comparison matters, spacious where decisions matter
- Keyboard-first and WCAG 2.2 AA
- Responsive from mobile to wide desktop
- Familiar controls with visible security and workflow state

## 2. Colors

The palette uses cool paper and mist neutrals with one quiet, medium-depth blue accent. Semantic states use distinct text, iconography, and labels in addition to colour.

### Primary

- **Harbour Blue:** Primary actions, active navigation, links, focus indication, and progress. The 600 step is the action default, 700 is hover and strong text, 500 is focus and progress, while 50 and 100 are selection surfaces.

### Neutral

- **Blue Slate:** 950 carries primary text, 700 carries secondary controls, and 500 carries metadata.
- **Paper:** Working surfaces, inputs, reports, menus, and the application sidebar.
- **Mist:** The page plane and quiet secondary surfaces. Mist Strong carries tracks, separators, and inactive fills.
- **Cool Border:** One-pixel structure between adjacent work areas.

### Named Rules

**The Ten Percent Rule.** Harbour Blue occupies no more than ten percent of a typical working screen. Its rarity preserves meaning.

**The Redundancy Rule.** Severity and workflow state always use text or iconography as well as colour.

## 3. Typography

**Display Font:** Geist (with system sans fallback)
**Body Font:** Geist (with system sans fallback)
**Label/Mono Font:** Geist Mono for identifiers and technical values only

**Character:** Compact, highly legible, and neutral enough to disappear during long working sessions. Hierarchy comes from weight, size, and placement instead of decorative pairing.

### Hierarchy

- **Display** (600, 2.25rem, 1.12): Authentication, onboarding, and meaningful empty states only.
- **Headline** (600, 1.5rem, 1.25): Route titles and major workspace identity.
- **Title** (600, 1rem, 1.5): Panels, grouped fields, and operational sections.
- **Body** (400, 0.875rem, 1.5): Controls, tables, and explanatory text; prose remains within 65 to 75 characters.
- **Label** (500, 0.75rem, sentence case): Metadata, table headers, badges, and field labels.

### Named Rules

**The Working Type Rule.** Display typography never competes with the work. Labels, values, and state remain the visual priority.

## 4. Elevation

The system is flat by default. Depth comes from tonal layers and one-pixel borders. Only transient overlapping surfaces use ambient elevation: the command palette uses a diffuse cool shadow, and mobile navigation uses a lower structural shadow.

### Shadow Vocabulary

- **Transient High** (`0 24px 80px rgba(28,45,65,0.22)`): Command palette only.
- **Transient Low** (`0 16px 50px rgba(28,45,65,0.08)`): Onboarding or a temporary isolated workflow surface.

### Named Rules

**The Lift-on-Demand Rule.** Resting content has no decorative shadow. A surface lifts only when it temporarily overlaps another surface.

## 5. Components

### Buttons

- **Shape:** Compact and gently curved (6px radius), with 36px default and 44px large touch targets.
- **Primary:** Harbour Blue 600 with tinted white text, 8px by 12px internal spacing.
- **Hover / Focus:** Harbour Blue 700 on hover; a three-pixel Harbour 500 focus outline with two-pixel offset.
- **Secondary / Ghost:** Paper with a cool border, or transparent with a Mist hover surface.

### Chips

- **Style:** Full pill, one-pixel semantic border, tinted background, short sentence-case label, and a leading filled dot.
- **State:** Colour always accompanies a readable status or severity name.

### Cards / Containers

- **Corner Style:** Group containers use a 14px radius; compact nested controls use 6px.
- **Background:** Paper on the Mist page plane.
- **Shadow Strategy:** Flat at rest; borders and tonal changes define groups.
- **Border:** One-pixel Cool Border.
- **Internal Padding:** 16px on mobile, 20 to 24px on wider screens.

### Inputs / Fields

- **Style:** Paper fill, one-pixel border, 6px radius, and 44px primary form height.
- **Focus:** Harbour 500 border plus the global three-pixel focus-visible outline.
- **Error / Disabled:** Text and border communicate error; disabled controls reduce opacity and block interaction.

### Navigation

Desktop navigation is a 248px persistent Paper sidebar. The active item uses Harbour 50 with Harbour 700 text. Mobile uses a compact header and an accessible slide-in navigation surface. Engagement sections form a horizontally scrollable tab row rather than truncating or hiding destinations.

### Command Palette

The command palette is the signature transient surface. Command+K and Control+K both open it. Search, navigation, recent destinations, and quick actions share one keyboard-operable list with visible selection and an escape hint.

## 6. Do's and Don'ts

### Do:

- **Do** reserve Harbour Blue 600 for meaningful action, active selection, and focus.
- **Do** maintain a three-pixel visible focus outline and complete keyboard paths.
- **Do** reflow workspaces structurally for mobile and permit intentional table or tab scrolling.
- **Do** keep approval, classification, evidence visibility, and publication state explicit.
- **Do** prefer inline and progressive workflows over modal interruption.

### Don't:

- **Don't** use legacy enterprise layouts, excessive dashboards, dense modal workflows, unnecessary page reloads, overly complicated navigation, or generic admin-template styling.
- **Don't** use neon-on-black palettes, terminal decoration, glowing threat maps, or fear-driven copy.
- **Don't** use glassmorphism, gradient text, decorative side stripes, or ornamental card grids.
- **Don't** communicate severity, status, or validation through colour alone.
- **Don't** remove functionality on mobile merely to simplify the layout.
