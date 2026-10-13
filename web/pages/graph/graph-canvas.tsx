import { Component, useEffect, useState, type ErrorInfo, type ReactNode, type RefObject } from "react";
import { SigmaContainer, useRegisterEvents, useSigma } from "@react-sigma/core";
import "@react-sigma/core/lib/style.css";
import FA2Layout from "graphology-layout-forceatlas2/worker";
import type { MultiDirectedGraph } from "graphology";
import type Sigma from "sigma";
import { EdgeArrowProgram, type EdgeProgramType } from "sigma/rendering";
import type { Settings } from "sigma/settings";
import type { GraphEdgeAttributes, GraphFilters, GraphNodeAttributes } from "./model";
import { nodeFilterState } from "./model";

interface GraphColors {
  node: string;
  selected: string;
  broken: string;
  muted: string;
  link: string;
  source: string;
  label: string;
}

const SIGMA_SETTINGS: Partial<Settings<GraphNodeAttributes, GraphEdgeAttributes>> = {
  allowInvalidContainer: true,
  defaultEdgeType: "arrow",
  edgeProgramClasses: { arrow: EdgeArrowProgram as unknown as EdgeProgramType<GraphNodeAttributes, GraphEdgeAttributes> },
  enableCameraPanning: true,
  enableCameraZooming: true,
  enableCameraRotation: false,
  renderEdgeLabels: false,
  labelDensity: 0.7,
  labelRenderedSizeThreshold: 7,
  minCameraRatio: 0.08,
  maxCameraRatio: 8,
} as const;

class GraphErrorBoundary extends Component<{ children: ReactNode; onFailure: (error?: Error) => void }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, _info: ErrorInfo) {
    this.props.onFailure(error);
  }

  render() {
    // 失败后通知父页面统一降级，不渲染本地化的 fallback UI
    return this.state.failed ? null : this.props.children;
  }
}

function cssColor(variable: string): string {
  const probe = document.createElement("span");
  probe.style.color = `color-mix(in srgb, var(${variable}), var(${variable}))`;
  probe.style.display = "none";
  document.body.appendChild(probe);
  const color = getComputedStyle(probe).color;
  probe.remove();
  const srgb = color.match(/^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\)$/);
  if (!srgb) return color;
  const channels = srgb.slice(1, 4).map((value) => Math.round(Math.min(1, Math.max(0, Number(value))) * 255));
  return srgb[4] === undefined
    ? `rgb(${channels.join(", ")})`
    : `rgba(${channels.join(", ")}, ${Math.min(1, Math.max(0, Number(srgb[4])))})`;
}

function readColors(): GraphColors {
  const muted = cssColor("--muted-foreground");
  const foreground = cssColor("--foreground");
  return {
    node: muted,
    muted,
    source: muted,
    selected: cssColor("--primary"),
    broken: cssColor("--destructive"),
    link: foreground,
    label: foreground,
  };
}

function GraphController({ graph, filters, selected, hovered, structureVersion, sigmaRef, onSelect, onHover, onFailure }: {
  graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>;
  filters: GraphFilters;
  selected?: string;
  hovered?: string;
  structureVersion: number;
  sigmaRef: RefObject<Sigma<GraphNodeAttributes, GraphEdgeAttributes> | null>;
  onSelect: (key: string) => void;
  onHover: (key?: string) => void;
  onFailure: (error?: Error) => void;
}) {
  const sigma = useSigma<GraphNodeAttributes, GraphEdgeAttributes>();
  const registerEvents = useRegisterEvents();
  // 主题颜色惰性初始化一次；仅监听根元素 class/style（主题切换），hover/select 不再触发 DOM 读色
  const [colors, setColors] = useState<GraphColors>(readColors);

  useEffect(() => {
    const refresh = () => {
      try {
        setColors(readColors());
      } catch {
        // 读取失败时保留上一版颜色
      }
    };
    const observer = new MutationObserver(refresh);
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ["class", "style"] });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    sigmaRef.current = sigma;
    return () => { sigmaRef.current = null; };
  }, [sigma, sigmaRef]);

  useEffect(() => {
    registerEvents({
      clickNode: ({ node }) => onSelect(node),
      enterNode: ({ node }) => onHover(node),
      leaveNode: () => onHover(undefined),
    });
  }, [onHover, onSelect, registerEvents]);

  useEffect(() => {
    let canvases: HTMLCanvasElement[];
    try {
      canvases = Object.values(sigma.getCanvases());
    } catch (error) {
      onFailure(error instanceof Error ? error : undefined);
      return;
    }
    const handleLoss = (event: Event) => {
      event.preventDefault();
      onFailure();
    };
    canvases.forEach((canvas) => canvas.addEventListener("webglcontextlost", handleLoss));
    return () => canvases.forEach((canvas) => canvas.removeEventListener("webglcontextlost", handleLoss));
  }, [onFailure, sigma]);

  useEffect(() => {
    const applySettings = () => {
      const focus = hovered ?? selected;
      const focusedNodes = new Set<string>();
      if (focus && graph.hasNode(focus)) {
        focusedNodes.add(focus);
        graph.forEachNeighbor(focus, (neighbor) => focusedNodes.add(neighbor));
      }
      sigma.setSettings({
      defaultNodeColor: colors.node,
      defaultEdgeColor: colors.link,
      labelColor: { color: colors.label },
      nodeReducer: (key, data) => {
        const state = nodeFilterState(data, filters);
        if (state.hidden) return { ...data, hidden: true };
        const focused = key === selected || key === hovered;
        const dimmed = !state.searchMatch || Boolean(focus && !focusedNodes.has(key));
        return {
          ...data,
          color: focused ? colors.selected : data.resolved ? (dimmed ? colors.muted : colors.node) : colors.broken,
          label: data.label,
          size: focused ? data.size + 3 : dimmed ? Math.max(2, data.size - 2) : data.size,
          zIndex: focused ? 2 : focus && focusedNodes.has(key) ? 1 : 0,
        };
      },
      edgeReducer: (key, data) => {
        const source = graph.source(key);
        const target = graph.target(key);
        const sourceState = nodeFilterState(graph.getNodeAttributes(source), filters);
        const targetState = nodeFilterState(graph.getNodeAttributes(target), filters);
        const connected = !focus || source === focus || target === focus;
        const searchMatch = sourceState.searchMatch && targetState.searchMatch;
        return {
          ...data,
          hidden: sourceState.hidden || targetState.hidden,
          color: connected && searchMatch ? (data.origin === "link" ? colors.link : colors.source) : colors.muted,
          size: connected && searchMatch ? data.size : Math.max(0.4, data.size / 2),
          zIndex: connected && Boolean(focus) ? 1 : 0,
        };
      },
      zIndex: true,
      });
      sigma.refresh();
    };
    try {
      applySettings();
    } catch (error) {
      onFailure(error instanceof Error ? error : undefined);
    }
  }, [colors, filters, graph, hovered, onFailure, selected, sigma]);

  useEffect(() => {
    if (structureVersion === 0 || graph.order < 2) return;
    let layout: FA2Layout | undefined;
    let killed = false;
    const finish = () => {
      if (!layout || killed) return;
      killed = true;
      try {
        layout.stop();
      } catch {}
      try {
        layout.kill();
      } catch {}
    };
    try {
      layout = new FA2Layout(graph, { settings: { gravity: 1, scalingRatio: 4, slowDown: 8 } });
      layout.start();
    } catch {
      finish();
      return;
    }
    const timer = window.setTimeout(finish, 1250);
    return () => {
      window.clearTimeout(timer);
      finish();
    };
  }, [graph, structureVersion]);

  return null;
}

export function GraphCanvas(props: {
  graph: MultiDirectedGraph<GraphNodeAttributes, GraphEdgeAttributes>;
  filters: GraphFilters;
  selected?: string;
  hovered?: string;
  structureVersion: number;
  sigmaRef: RefObject<Sigma<GraphNodeAttributes, GraphEdgeAttributes> | null>;
  onSelect: (key: string) => void;
  onHover: (key?: string) => void;
  onFailure: (error?: Error) => void;
}) {
  return (
    <GraphErrorBoundary onFailure={props.onFailure}>
      <SigmaContainer<GraphNodeAttributes, GraphEdgeAttributes> className="h-96 w-full" graph={props.graph} settings={SIGMA_SETTINGS}>
        <GraphController {...props} />
      </SigmaContainer>
    </GraphErrorBoundary>
  );
}

export function supportsWebGL(): boolean {
  try {
    const canvas = document.createElement("canvas");
    return Boolean(canvas.getContext("webgl2") || canvas.getContext("webgl"));
  } catch {
    return false;
  }
}
