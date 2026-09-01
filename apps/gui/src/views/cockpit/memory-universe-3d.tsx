import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import * as THREE from "three";
import type { MemoryGraphData, MemoryGraphNode } from "../../lib/claude-sessions-client.js";

function readColor(cssVar: string, fallback: string): string {
  if (typeof window === "undefined") return fallback;
  const v = getComputedStyle(document.documentElement).getPropertyValue(cssVar).trim();
  return v.length > 0 ? v : fallback;
}

const PALETTE: Record<string, { cssVar: string; fallback: string }> = {
  project: { cssVar: "--graph-project", fallback: "#7C3AED" },
  session: { cssVar: "--graph-session", fallback: "#2563EB" },
  memory: { cssVar: "--graph-memory", fallback: "#059669" },
  "memory-decision": { cssVar: "--graph-memory-decision", fallback: "#0EA5E9" },
  "memory-bug": { cssVar: "--graph-memory-bug", fallback: "#DC2626" },
  "memory-architecture": { cssVar: "--graph-memory-architecture", fallback: "#0D9488" },
  evidence: { cssVar: "--graph-evidence", fallback: "#D97706" },
  chunkset: { cssVar: "--graph-chunkset", fallback: "#6B7280" },
  file: { cssVar: "--graph-file", fallback: "#475569" },
  symbol: { cssVar: "--graph-symbol", fallback: "#64748B" },
  wiki: { cssVar: "--graph-wiki", fallback: "#9333EA" },
};

function colorForKey(key: string): string {
  const fallback = PALETTE["memory"] ?? { cssVar: "--graph-memory", fallback: "#059669" };
  const entry = PALETTE[key] ?? fallback;
  return readColor(entry.cssVar, entry.fallback);
}

interface ActiveLayersState {
  decisions: boolean;
  architecture: boolean;
  bugs: boolean;
  wiki: boolean;
  evidence: boolean;
  code: boolean;
}

export function nodeColor(node: MemoryGraphNode): string {
  if (node.kind !== "memory") return colorForKey(node.kind);
  const memoryType = node.meta?.["memoryType"];
  if (typeof memoryType === "string" && PALETTE[`memory-${memoryType}`]) {
    return colorForKey(`memory-${memoryType}`);
  }
  return colorForKey("memory");
}

function isJsdom(): boolean {
  return typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent ?? "");
}

function isWebGL2Supported(): boolean {
  if (typeof window === "undefined") return true;
  if (isJsdom()) return true;
  try {
    if (!window.WebGL2RenderingContext) return false;
    const canvas = document.createElement("canvas");
    return canvas.getContext("webgl2") !== null;
  } catch {
    return false;
  }
}

const DEFAULT_SPHERICAL = { radius: 220, theta: 0, phi: Math.PI / 3 } as const;

export function MemoryUniverse3D({
  data,
  onSelectNode,
}: {
  data: MemoryGraphData;
  onSelectNode?: (node: MemoryGraphNode | null) => void;
}): JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const [selectedNode, setSelectedNode] = useState<MemoryGraphNode | null>(null);
  const [hoveredNode, setHoveredNode] = useState<MemoryGraphNode | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeLayers, setActiveLayers] = useState<ActiveLayersState>({
    decisions: true,
    architecture: true,
    bugs: true,
    wiki: true,
    evidence: true,
    code: true,
  });
  const [webGLUnsupported, setWebGLUnsupported] = useState(false);

  // P0 perf: keep Three.js meshes alive across search keystrokes. Layer toggles still rebuild.
  const nodeMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map());
  const sphericalRef = useRef({ ...DEFAULT_SPHERICAL });
  const cameraRef = useRef<THREE.PerspectiveCamera | null>(null);
  const updateCameraPosRef = useRef<() => void>(() => {});

  const handleCameraReset = useCallback(() => {
    sphericalRef.current.radius = DEFAULT_SPHERICAL.radius;
    sphericalRef.current.theta = DEFAULT_SPHERICAL.theta;
    sphericalRef.current.phi = DEFAULT_SPHERICAL.phi;
    updateCameraPosRef.current();
  }, []);

  // Layer filtering determines which nodes exist in the 3D scene (scene rebuild required).
  // Search highlighting is intentionally NOT part of this memo — it is applied as a
  // lightweight material update in a separate effect (nodeMeshesRef) so typing does
  // not tear down and rebuild the entire WebGL scene. Trade-off: search now dims
  // non-matching nodes instead of removing them; future layers could also move to
  // visibility toggles if rebuild cost remains high.
  const filteredNodes = useMemo(() => {
    return data.nodes.filter((n) => {
      if (n.kind === "wiki" && !activeLayers.wiki) return false;
      if ((n.kind === "file" || n.kind === "symbol") && !activeLayers.code) return false;
      if ((n.kind === "evidence" || n.kind === "chunkset") && !activeLayers.evidence) return false;
      if (n.kind === "memory") {
        const memType = String(n.meta?.["memoryType"] ?? "");
        if (memType === "decision" && !activeLayers.decisions) return false;
        if (memType === "architecture" && !activeLayers.architecture) return false;
        if (memType === "bug" && !activeLayers.bugs) return false;
      }
      return true;
    });
  }, [data.nodes, activeLayers]);

  const filteredNodeIds = useMemo(() => new Set(filteredNodes.map((n) => n.id)), [filteredNodes]);

  const filteredEdges = useMemo(() => {
    return data.edges.filter((e) => filteredNodeIds.has(e.from) && filteredNodeIds.has(e.to));
  }, [data.edges, filteredNodeIds]);

  // Search highlighting updates existing meshes in-place so typing does not
  // trigger a full WebGL scene teardown. See filteredNodes comment above.
  useEffect(() => {
    const q = searchQuery.trim().toLowerCase();
    const hasQuery = q.length > 0;
    for (const mesh of nodeMeshesRef.current.values()) {
      const label = String((mesh.userData as Record<string, unknown>)["label"] ?? "");
      const isHighlighted = !hasQuery || label.toLowerCase().includes(q);
      const mat = mesh.material as THREE.MeshStandardMaterial;
      mat.opacity = isHighlighted ? 1 : 0.25;
      mat.emissiveIntensity = isHighlighted ? 0.6 : 0.1;
    }
  }, [searchQuery]);

  const handleSelect = useCallback(
    (node: MemoryGraphNode | null) => {
      setSelectedNode(node);
      onSelectNode?.(node);
    },
    [onSelectNode],
  );

  // Three.js Scene Setup & Render Loop
  // P0 fix: searchQuery no longer tears down the scene; highlighting is handled
  // in the lightweight effect above via nodeMeshesRef. filteredNodes/Edges deps
  // remain necessary because layer toggles change topology (add/remove meshes).
  // biome-ignore lint/correctness/useExhaustiveDependencies: search highlight intentionally excluded — scene rebuild on each keystroke is the thrash this P0 fixes (see perf comment above).
  useEffect(() => {
    if (isJsdom()) return;
    if (!isWebGL2Supported()) {
      setWebGLUnsupported(true);
      return;
    }
    const container = containerRef.current;
    if (!container) return;

    let width = container.clientWidth || 0;
    let height = container.clientHeight || 0;
    // Defer first paint sizing to ResizeObserver so a 0-sized container on tab
    // switch does not leave the canvas blank (mirrors memory-graph-panel.tsx).
    const hasInitialSize = width > 0 && height > 0;
    if (!hasInitialSize) {
      width = 800;
      height = 600;
    }

    // 1. Scene, Camera, Renderer
    const bg = readColor("--color-background", "#f4f2ee");
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(bg);
    scene.fog = new THREE.FogExp2(bg, 0.0018);

    const camera = new THREE.PerspectiveCamera(55, width / height, 0.1, 2000);
    camera.position.set(0, 80, 220);
    cameraRef.current = camera;

    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(renderer.domElement);
    } catch {
      setWebGLUnsupported(true);
      return;
    }

    // 2. Lighting
    const ambientLight = new THREE.AmbientLight("#FFFFFF", 0.8);
    scene.add(ambientLight);

    const pointLight = new THREE.PointLight("#6366F1", 2, 400);
    pointLight.position.set(0, 0, 0);
    scene.add(pointLight);

    // 3. Cosmic Starfield Background Particles
    const starCount = 1200;
    const starGeo = new THREE.BufferGeometry();
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount * 3; i += 3) {
      starPositions[i] = (Math.random() - 0.5) * 1200;
      starPositions[i + 1] = (Math.random() - 0.5) * 1200;
      starPositions[i + 2] = (Math.random() - 0.5) * 1200;
    }
    starGeo.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMat = new THREE.PointsMaterial({
      color: "#94A3B8",
      size: 1.5,
      transparent: true,
      opacity: 0.6,
    });
    const starField = new THREE.Points(starGeo, starMat);
    scene.add(starField);

    // 4. Central Core Pulsar Sphere
    const coreGeo = new THREE.SphereGeometry(6, 32, 32);
    const coreMat = new THREE.MeshStandardMaterial({
      color: "#8B5CF6",
      emissive: "#6D28D9",
      emissiveIntensity: 0.8,
      roughness: 0.2,
      metalness: 0.8,
    });
    const coreMesh = new THREE.Mesh(coreGeo, coreMat);
    scene.add(coreMesh);

    // 5. Node Meshes (Spherical orbital placement)
    const nodeMeshes = new Map<string, THREE.Mesh>();
    const nodeObjMap = new Map<THREE.Object3D, MemoryGraphNode>();
    const nodePositions = new Map<string, THREE.Vector3>();

    const sphereGeo = new THREE.SphereGeometry(3.2, 24, 24);
    const lineGeos: THREE.BufferGeometry[] = [];

    filteredNodes.forEach((node, idx) => {
      const color = nodeColor(node);

      const mat = new THREE.MeshStandardMaterial({
        color,
        emissive: color,
        emissiveIntensity: 0.6,
        roughness: 0.3,
        metalness: 0.4,
        transparent: true,
        opacity: 1,
      });

      const mesh = new THREE.Mesh(sphereGeo, mat);
      // stash label for search highlight pass that runs without scene rebuild
      (mesh.userData as Record<string, unknown>)["label"] = node.label;

      // Distribute nodes in Fibonacci orbital sphere
      const phi = Math.acos(-1 + (2 * idx) / Math.max(1, filteredNodes.length));
      const theta = Math.sqrt(filteredNodes.length * Math.PI) * phi;
      const radius = 45 + (idx % 4) * 25 + Math.sin(idx) * 10;

      const pos = new THREE.Vector3(
        radius * Math.cos(theta) * Math.sin(phi),
        radius * Math.sin(theta) * Math.sin(phi),
        radius * Math.cos(phi),
      );

      mesh.position.copy(pos);
      scene.add(mesh);
      nodeMeshes.set(node.id, mesh);
      nodeObjMap.set(mesh, node);
      nodePositions.set(node.id, pos);
    });
    nodeMeshesRef.current = nodeMeshes;
    // Apply current search highlight without waiting for next keystroke tick.
    {
      const q = searchQuery.trim().toLowerCase();
      const hasQuery = q.length > 0;
      for (const mesh of nodeMeshes.values()) {
        const label = String((mesh.userData as Record<string, unknown>)["label"] ?? "");
        const isHighlighted = !hasQuery || label.toLowerCase().includes(q);
        const m = mesh.material as THREE.MeshStandardMaterial;
        m.opacity = isHighlighted ? 1 : 0.25;
        m.emissiveIntensity = isHighlighted ? 0.6 : 0.1;
      }
    }

    // 6. Constellation Edge Lines
    const lineMat = new THREE.LineBasicMaterial({
      color: "#475569",
      transparent: true,
      opacity: 0.35,
    });

    for (const edge of filteredEdges) {
      const fromPos = nodePositions.get(edge.from);
      const toPos = nodePositions.get(edge.to);
      if (fromPos && toPos) {
        const lineGeo = new THREE.BufferGeometry().setFromPoints([fromPos, toPos]);
        lineGeos.push(lineGeo);
        const line = new THREE.Line(lineGeo, lineMat);
        scene.add(line);
      }
    }

    // 7. Interactive Orbit & Raycasting Controls
    let isDragging = false;
    let prevMouseX = 0;
    let prevMouseY = 0;
    sphericalRef.current = { ...DEFAULT_SPHERICAL };
    const spherical = sphericalRef.current;

    const updateCameraPos = () => {
      camera.position.x = spherical.radius * Math.sin(spherical.phi) * Math.sin(spherical.theta);
      camera.position.y = spherical.radius * Math.cos(spherical.phi);
      camera.position.z = spherical.radius * Math.sin(spherical.phi) * Math.cos(spherical.theta);
      camera.lookAt(0, 0, 0);
    };
    updateCameraPosRef.current = updateCameraPos;
    updateCameraPos();

    const onMouseDown = (e: MouseEvent) => {
      isDragging = true;
      prevMouseX = e.clientX;
      prevMouseY = e.clientY;
    };

    const onMouseMove = (e: MouseEvent) => {
      if (isDragging) {
        const deltaX = e.clientX - prevMouseX;
        const deltaY = e.clientY - prevMouseY;
        spherical.theta -= deltaX * 0.005;
        spherical.phi = Math.max(0.1, Math.min(Math.PI - 0.1, spherical.phi - deltaY * 0.005));
        updateCameraPos();
        prevMouseX = e.clientX;
        prevMouseY = e.clientY;
      }

      // Raycasting for hover tooltip
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / width) * 2 - 1,
        -((e.clientY - rect.top) / height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects([...nodeObjMap.keys()]);
      if (intersects.length > 0 && intersects[0]?.object) {
        const found = nodeObjMap.get(intersects[0].object);
        setHoveredNode(found ?? null);
        container.style.cursor = "pointer";
      } else {
        setHoveredNode(null);
        container.style.cursor = isDragging ? "grabbing" : "grab";
      }
    };

    const onMouseUp = () => {
      isDragging = false;
      if (container) container.style.cursor = "grab";
    };

    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      (spherical as { radius: number }).radius = Math.max(
        40,
        Math.min(600, spherical.radius + e.deltaY * 0.2),
      );
      updateCameraPos();
    };

    const onClick = (e: MouseEvent) => {
      const rect = container.getBoundingClientRect();
      const mouse = new THREE.Vector2(
        ((e.clientX - rect.left) / width) * 2 - 1,
        -((e.clientY - rect.top) / height) * 2 + 1,
      );
      const raycaster = new THREE.Raycaster();
      raycaster.setFromCamera(mouse, camera);
      const intersects = raycaster.intersectObjects([...nodeObjMap.keys()]);
      if (intersects.length > 0 && intersects[0]?.object) {
        const found = nodeObjMap.get(intersects[0].object);
        if (found) handleSelect(found);
      }
    };

    container.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    container.addEventListener("wheel", onWheel, { passive: false });
    container.addEventListener("click", onClick);

    // 8. Animation Render Loop
    let animationFrameId: number;
    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);

      // Subtle celestial rotation
      starField.rotation.y += 0.0003;
      coreMesh.rotation.y += 0.005;

      renderer.render(scene, camera);
    };
    animate();

    const resizeObserver = new ResizeObserver((entries) => {
      if (!container) return;
      const entry = entries[0];
      const cr = entry?.contentRect;
      const nextW = Math.round(cr?.width ?? container.clientWidth);
      const nextH = Math.round(cr?.height ?? container.clientHeight);
      if (nextW === 0 || nextH === 0) return;
      width = nextW;
      height = nextH;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resizeObserver.observe(container);
    // If container was 0-sized on mount, observer's first delivery fixes first paint.

    return () => {
      cancelAnimationFrame(animationFrameId);
      container.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      container.removeEventListener("wheel", onWheel);
      container.removeEventListener("click", onClick);
      resizeObserver.disconnect();
      cameraRef.current = null;
      nodeMeshesRef.current = new Map();
      // Prevent leaks on repeated mounts (tab switches): dispose shared and per-node GPU resources.
      for (const mesh of nodeMeshes.values()) {
        (mesh.material as THREE.Material).dispose();
      }
      for (const lg of lineGeos) lg.dispose();
      starGeo.dispose();
      coreGeo.dispose();
      sphereGeo.dispose();
      starMat.dispose();
      coreMat.dispose();
      lineMat.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === container) {
        container.removeChild(renderer.domElement);
      }
    };
  }, [filteredNodes, filteredEdges, handleSelect]);

  const toggleLayer = (key: keyof ActiveLayersState) => {
    setActiveLayers((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  if (webGLUnsupported) {
    return (
      <div className="relative w-full h-[650px] rounded-xl overflow-hidden border border-border bg-background select-none font-sans p-6 flex flex-col gap-4 overflow-y-auto">
        <p className="text-sm text-text-muted">
          WebGL not supported - showing 2D fallback ({filteredNodes.length} nodes ·{" "}
          {filteredEdges.length} links)
        </p>
        <div className="flex items-center gap-2">
          <input
            type="text"
            aria-label="Search memory nodes"
            placeholder="Search celestial memory nodes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="flex-1 px-3 py-1.5 rounded-lg bg-surface border border-border text-xs text-text-primary placeholder:text-text-muted"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-xs text-text-muted hover:text-text-primary px-2"
            >
              ✕ Clear
            </button>
          )}
        </div>
        <ul aria-label="Memory nodes fallback list" className="flex flex-col gap-1.5">
          {filteredNodes.map((n) => (
            <li
              key={n.id}
              className="flex items-center gap-2 px-3 py-2 rounded-lg border border-border bg-surface text-xs"
            >
              <span
                className="w-2 h-2 rounded-full shrink-0"
                style={{ backgroundColor: nodeColor(n) }}
                aria-hidden="true"
              />
              <span className="font-medium text-text-primary truncate">{n.label}</span>
              <span className="text-2xs text-text-muted uppercase">{n.kind}</span>
            </li>
          ))}
        </ul>
        {filteredNodes.length === 0 && (
          <p className="text-xs text-text-muted text-center py-8">
            No nodes match &ldquo;{searchQuery}&rdquo; with current filters.
          </p>
        )}
      </div>
    );
  }

  return (
    <div className="relative w-full h-[650px] rounded-xl overflow-hidden border border-border bg-background select-none font-sans">
      {/* 3D WebGL Canvas */}
      <div
        ref={containerRef}
        role="img"
        aria-label="3D memory universe"
        className="w-full h-full cursor-grab active:cursor-grabbing"
      />

      {/* Floating Top-Left HUD Controls */}
      <div className="absolute top-4 left-4 z-10 flex flex-col gap-2.5 max-w-sm pointer-events-auto">
        <div className="flex items-center gap-2 px-3 py-1.5 rounded-lg bg-surface/80 backdrop-blur-md border border-border/80 shadow-lg">
          <span className="text-xs text-accent">⌕</span>
          <input
            type="text"
            aria-label="Search memory nodes"
            placeholder="Search celestial memory nodes…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="bg-transparent border-none outline-none text-xs text-text-primary placeholder:text-text-muted w-48"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="text-xs text-text-muted hover:text-text-primary"
            >
              ✕
            </button>
          )}
        </div>

        {/* Category Filters */}
        <div className="flex flex-wrap gap-1.5 p-2 rounded-lg bg-surface/70 backdrop-blur-md border border-border/60 shadow-md">
          <button
            type="button"
            aria-pressed={activeLayers.decisions}
            onClick={() => toggleLayer("decisions")}
            className={`px-2 py-0.5 rounded text-2xs font-medium transition-all ${
              activeLayers.decisions
                ? "bg-[#0EA5E9]/20 text-[#38BDF8] border border-[#0EA5E9]/40"
                : "bg-background/40 text-text-muted border border-border/30 opacity-60"
            }`}
          >
            ● Decisions
          </button>
          <button
            type="button"
            aria-pressed={activeLayers.architecture}
            onClick={() => toggleLayer("architecture")}
            className={`px-2 py-0.5 rounded text-2xs font-medium transition-all ${
              activeLayers.architecture
                ? "bg-[#0D9488]/20 text-[#2DD4BF] border border-[#0D9488]/40"
                : "bg-background/40 text-text-muted border border-border/30 opacity-60"
            }`}
          >
            ● Architecture
          </button>
          <button
            type="button"
            aria-pressed={activeLayers.bugs}
            onClick={() => toggleLayer("bugs")}
            className={`px-2 py-0.5 rounded text-2xs font-medium transition-all ${
              activeLayers.bugs
                ? "bg-[#DC2626]/20 text-[#F87171] border border-[#DC2626]/40"
                : "bg-background/40 text-text-muted border border-border/30 opacity-60"
            }`}
          >
            ● Bugs
          </button>
          <button
            type="button"
            aria-pressed={activeLayers.wiki}
            onClick={() => toggleLayer("wiki")}
            className={`px-2 py-0.5 rounded text-2xs font-medium transition-all ${
              activeLayers.wiki
                ? "bg-[#9333EA]/20 text-[#C084FC] border border-[#9333EA]/40"
                : "bg-background/40 text-text-muted border border-border/30 opacity-60"
            }`}
          >
            ● Wiki
          </button>
          <button
            type="button"
            aria-pressed={activeLayers.evidence}
            onClick={() => toggleLayer("evidence")}
            className={`px-2 py-0.5 rounded text-2xs font-medium transition-all ${
              activeLayers.evidence
                ? "bg-[#D97706]/20 text-[#FBBF24] border border-[#D97706]/40"
                : "bg-background/40 text-text-muted border border-border/30 opacity-60"
            }`}
          >
            ● Evidence
          </button>
          <button
            type="button"
            aria-pressed={activeLayers.code}
            onClick={() => toggleLayer("code")}
            className={`px-2 py-0.5 rounded text-2xs font-medium transition-all ${
              activeLayers.code
                ? "bg-[#64748B]/20 text-[#94A3B8] border border-[#64748B]/40"
                : "bg-background/40 text-text-muted border border-border/30 opacity-60"
            }`}
          >
            ● Code
          </button>
        </div>
      </div>

      {/* Floating Top-Right Universe Statistics + Camera Reset */}
      <div className="absolute top-4 right-4 z-10 flex items-center gap-2 pointer-events-auto">
        <div className="flex items-center gap-3 px-3 py-1.5 rounded-lg bg-surface/70 backdrop-blur-md border border-border/60 text-xs text-text-muted">
          <span>
            <strong className="text-text-primary">{filteredNodes.length}</strong> nodes
          </span>
          <span>•</span>
          <span>
            <strong className="text-text-primary">{filteredEdges.length}</strong> links
          </span>
          <span>•</span>
          <span className="text-accent font-medium">3D Universe System</span>
        </div>
        <button
          type="button"
          aria-label="Reset camera"
          title="Reset camera to default view"
          onClick={handleCameraReset}
          className="px-2.5 py-1.5 rounded-lg bg-surface/80 backdrop-blur-md border border-border/80 shadow-lg text-xs font-medium text-text-primary hover:bg-surface transition-colors"
        >
          ◎ Reset view
        </button>
      </div>

      {/* Hover Tooltip */}
      {hoveredNode && !selectedNode && (
        <div
          aria-live="polite"
          className="absolute bottom-6 left-6 z-20 px-3 py-2 rounded-lg bg-surface/90 backdrop-blur-md border border-border shadow-xl pointer-events-none animate-in fade-in duration-150 max-w-xs"
        >
          <div className="flex items-center gap-2">
            <span
              className="w-2 h-2 rounded-full"
              style={{ backgroundColor: nodeColor(hoveredNode) }}
            />
            <span className="text-xs font-semibold text-text-primary truncate">
              {hoveredNode.label}
            </span>
          </div>
          <span className="text-2xs text-text-muted uppercase tracking-wider mt-0.5 block">
            {hoveredNode.kind}
          </span>
        </div>
      )}

      {/* Glassmorphic Side Inspector Drawer */}
      {selectedNode && (
        <div
          role="complementary"
          aria-label="Node inspector"
          className="absolute top-4 bottom-4 right-4 z-30 w-80 p-4 rounded-xl bg-surface/90 backdrop-blur-xl border border-border/80 shadow-2xl flex flex-col gap-3 overflow-y-auto pointer-events-auto pop-in"
        >
          <div className="flex items-start justify-between">
            <div className="flex items-center gap-2">
              <span
                className="w-2.5 h-2.5 rounded-full"
                style={{ backgroundColor: nodeColor(selectedNode) }}
              />
              <span className="text-xs font-bold uppercase tracking-wider text-text-muted">
                {selectedNode.kind}
              </span>
            </div>
            <button
              type="button"
              onClick={() => handleSelect(null)}
              className="text-xs text-text-muted hover:text-text-primary p-1"
            >
              ✕
            </button>
          </div>

          <div>
            <h4 className="text-sm font-semibold text-text-primary m-0">{selectedNode.label}</h4>
            <p className="text-xs text-text-muted font-mono mt-1 break-all">{selectedNode.id}</p>
          </div>

          {selectedNode.meta && (
            <div className="flex flex-col gap-2 pt-2 border-t border-border/50 text-xs">
              {selectedNode.meta["confidence"] !== undefined && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Confidence:</span>
                  <span className="text-text-primary font-medium">
                    {String(selectedNode.meta["confidence"])}
                  </span>
                </div>
              )}
              {selectedNode.meta["memoryType"] !== undefined && (
                <div className="flex justify-between">
                  <span className="text-text-muted">Category:</span>
                  <span className="text-accent font-medium">
                    {String(selectedNode.meta["memoryType"])}
                  </span>
                </div>
              )}
              {selectedNode.meta["relatedFiles"] !== undefined && (
                <div>
                  <span className="text-text-muted block mb-1">Related Files:</span>
                  <div className="flex flex-wrap gap-1 font-mono text-2xs">
                    {Array.isArray(selectedNode.meta["relatedFiles"])
                      ? (selectedNode.meta["relatedFiles"] as string[]).map((f) => (
                          <span
                            key={f}
                            className="px-1.5 py-0.5 rounded bg-background border border-border"
                          >
                            {f}
                          </span>
                        ))
                      : null}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
