export interface ChartRuntimeLogicalRange {
  from: number;
  to: number;
}

export interface ChartRuntimeVisibleTimeRange {
  from: unknown;
  to: unknown;
}

export interface ChartRuntimeViewportState {
  schemaVersion: 1;
  logicalRange?: ChartRuntimeLogicalRange;
  visibleTimeRange?: ChartRuntimeVisibleTimeRange;
  viewportBarCount?: number;
  followLatest?: boolean;
}

/**
 * Generic horizontal viewport coordination capability.
 *
 * The implementation may persist state, delay first paint, or stabilize layout
 * mutations, but consumers only see one runtime service and never patch the base
 * chart controller to add feature-specific viewport behavior.
 */
export interface ChartRuntimeViewportService {
  read(): ChartRuntimeViewportState | undefined;
  apply(state: ChartRuntimeViewportState): void;
  beginLayoutMutation(reason?: string): () => void;
  flush(): void;
}
