# Redesigned Memory Architecture with 3 Dedicated Tabs & 3D Universe System

## Goal
Transform the Mega Saver GUI Memory view into a 3-tab layout with full-width dedicated views for **Living Brain**, **3D Universal Memory Graph**, and **Decision Trace**, replacing the 2D graph with an interactive, Three.js WebGL-powered 3D Cosmic System.

## Architecture

### 1. Tab Navigation & View Management (`MemoryPage`)
- **Tabs:**
  1. `⚡ Living Brain`: Living Brain Sync management, note composer, filterable & searchable memory list, inline editing, delete, reopen, and lineage explain actions.
  2. `🪐 Memory Graph`: Immersive Three.js 3D Universe graph canvas with orbital star systems, glowing connection constellations, floating HUD controls, and a glassmorphism node inspector.
  3. `🌿 Decision Trace`: Decision DAG trace canvas, session picker, and timeline inspection.
- **State Management:**
  - Active tab persisted in local state and synced with URL parameter `?tab=brain|graph|trace`.
  - Workspace selector integrated via TopBar and preserved across tab switches.

### 2. 3D Universal System (`MemoryUniverse3D`)
- **Technology:** Three.js with WebGLRenderer, OrbitControls, and custom particle/shader materials.
- **Visual Encoding:**
  - **Ambient Field:** 1,200 particle stardust starfield with subtle pulsing luminescence.
  - **Workspace Anchor:** Central glowing pulsar sphere at `(0, 0, 0)`.
  - **Node Clusters:** 3D force-directed / spherical orbital layout with distance decay:
    - *Decision* (`#0EA5E9` - Sky blue glow)
    - *Architecture* (`#0D9488` - Teal glow)
    - *Bug / Failure* (`#DC2626` - Crimson glow)
    - *Wiki / Knowledge* (`#9333EA` - Purple glow)
    - *Evidence / Chunk* (`#D97706` - Amber glow)
    - *File / Symbol* (`#64748B` - Slate glow)
  - **Edges:** Glowing line segments with opacity based on relationship type (`cites`, `supersedes`, `chunk-of`, `code-link`).
- **Interactive Capabilities:**
  - **Camera Controls:** 360° orbital rotation, pan, smooth zoom with clamp limits.
  - **Raycasting:** Hover tooltip with node label and type badge; highlights connected edges and neighboring stars.
  - **Click-to-Focus:** Smooth camera interpolation (tween) to zoom and orbit the selected node.
  - **Floating HUD:**
    - Search input: Real-time search highlighting matching nodes and dimming non-matches.
    - Category toggles: Filter node categories (Wiki, Code Bridges, Evidence, Decisions, Bugs).
    - Camera reset button: Returns camera to default panoramic orbital view.
  - **Node Inspector Drawer:** Glassmorphic slide-over card displaying node title, content, type, confidence, created/updated timestamps, and citation links.

### 3. Dedicated Tab Components
1. **`LivingBrainTab`:**
   - Full-width two-column layout:
     - Left column: `BrainSyncCard` (1-click activate, Push, Pull, generation status, recovery code helper).
     - Right column: New memory composer + comprehensive memory list with search, category tabs (All, Decisions, Architecture, Bugs, Conventions), inline actions.
2. **`MemoryUniverseTab`:**
   - Full-width 3D Canvas with overlay HUD controls and node inspector panel.
3. **`DecisionTraceTab`:**
   - Dedicated Decision Trace canvas and session inspector.

## Testing Strategy
- Unit tests for tab switching in `MemoryPage`.
- Unit tests for 3D Universe graph data mapping, node coloring, and filtering.
- Component tests for `LivingBrainTab`, `MemoryUniverseTab`, and `DecisionTraceTab`.
- Full `pnpm verify` DoD gate.
