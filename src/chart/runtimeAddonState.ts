export const CHART_RUNTIME_ADDON_STATE_SCHEMA_VERSION = 1 as const;

/**
 * One JSON-serializable state node owned semantically by an add-on.
 *
 * Runtime/Factory never inspect `state`. The add-on that owns `id` defines and
 * validates every child property inside that opaque subtree.
 */
export interface ChartRuntimeAddonStateNode<TState = unknown> {
  enabled: boolean;
  state: TState;
}

/**
 * Per-chart add-on composition/state document.
 *
 * `visualsVisible` is a master projection gate only. It never rewrites an
 * add-on's own enabled flag or any child property in its opaque state tree.
 */
export interface ChartRuntimeAddonStateDocument {
  schemaVersion: typeof CHART_RUNTIME_ADDON_STATE_SCHEMA_VERSION;
  visualsVisible: boolean;
  addons: Readonly<Record<string, ChartRuntimeAddonStateNode>>;
}

export type ChartRuntimeAddonStateSubscriber<TState = unknown> = (
  node: ChartRuntimeAddonStateNode<TState> | undefined,
  document: ChartRuntimeAddonStateDocument,
) => void;

export interface ChartRuntimeAddonStateStore {
  snapshot(): ChartRuntimeAddonStateDocument;
  replace(document: ChartRuntimeAddonStateDocument): void;
  read<TState = unknown>(id: string): ChartRuntimeAddonStateNode<TState> | undefined;
  write<TState = unknown>(id: string, node: ChartRuntimeAddonStateNode<TState>): void;
  update<TState = unknown>(
    id: string,
    updater: (
      current: ChartRuntimeAddonStateNode<TState> | undefined,
    ) => ChartRuntimeAddonStateNode<TState>,
  ): void;
  remove(id: string): void;
  setVisualsVisible(visible: boolean): void;
  subscribe<TState = unknown>(
    id: string,
    subscriber: ChartRuntimeAddonStateSubscriber<TState>,
  ): () => void;
  subscribeDocument(
    subscriber: (document: ChartRuntimeAddonStateDocument) => void,
  ): () => void;
}

function keyOf(id: string): string {
  const key = String(id ?? '').trim();
  if (!key) throw new Error('Chart runtime add-on state id is required.');
  return key;
}

function cloneJson<T>(value: T): T {
  if (value === undefined) return value;
  return JSON.parse(JSON.stringify(value)) as T;
}

function cloneNode<TState>(
  node: ChartRuntimeAddonStateNode<TState>,
): ChartRuntimeAddonStateNode<TState> {
  return {
    enabled: node.enabled !== false,
    state: cloneJson(node.state),
  };
}

function normalizeDocument(
  document?: ChartRuntimeAddonStateDocument,
): ChartRuntimeAddonStateDocument {
  const addons: Record<string, ChartRuntimeAddonStateNode> = {};
  const rawAddons = document?.addons;
  if (rawAddons && typeof rawAddons === 'object') {
    for (const [id, node] of Object.entries(rawAddons)) {
      const key = String(id ?? '').trim();
      if (!key || !node || typeof node !== 'object') continue;
      addons[key] = cloneNode(node);
    }
  }
  return {
    schemaVersion: CHART_RUNTIME_ADDON_STATE_SCHEMA_VERSION,
    visualsVisible: document?.visualsVisible !== false,
    addons,
  };
}

/**
 * In-memory owner for one chart's add-on JSON state tree.
 *
 * All mutation methods commit the JSON document first and notify subscribers
 * only after the authoritative document has changed. Rendering is therefore a
 * projection of state, never a second source of truth.
 */
export class ChartRuntimeAddonStateStoreImpl implements ChartRuntimeAddonStateStore {
  private document: ChartRuntimeAddonStateDocument;
  private readonly subscribers = new Map<
    string,
    Set<ChartRuntimeAddonStateSubscriber<any>>
  >();
  private readonly documentSubscribers = new Set<
    (document: ChartRuntimeAddonStateDocument) => void
  >();

  constructor(initial?: ChartRuntimeAddonStateDocument) {
    this.document = normalizeDocument(initial);
  }

  snapshot(): ChartRuntimeAddonStateDocument {
    return normalizeDocument(this.document);
  }

  replace(document: ChartRuntimeAddonStateDocument): void {
    this.document = normalizeDocument(document);
    this.notifyAll();
  }

  read<TState = unknown>(id: string): ChartRuntimeAddonStateNode<TState> | undefined {
    const node = this.document.addons[keyOf(id)];
    return node ? cloneNode(node as ChartRuntimeAddonStateNode<TState>) : undefined;
  }

  write<TState = unknown>(id: string, node: ChartRuntimeAddonStateNode<TState>): void {
    const key = keyOf(id);
    const addons = { ...this.document.addons, [key]: cloneNode(node) };
    this.document = { ...this.document, addons };
    this.notify(key);
  }

  update<TState = unknown>(
    id: string,
    updater: (
      current: ChartRuntimeAddonStateNode<TState> | undefined,
    ) => ChartRuntimeAddonStateNode<TState>,
  ): void {
    const key = keyOf(id);
    const next = updater(this.read<TState>(key));
    this.write(key, next);
  }

  remove(id: string): void {
    const key = keyOf(id);
    if (!(key in this.document.addons)) return;
    const addons = { ...this.document.addons };
    delete addons[key];
    this.document = { ...this.document, addons };
    this.notify(key);
  }

  setVisualsVisible(visible: boolean): void {
    const next = visible !== false;
    if (this.document.visualsVisible === next) return;
    this.document = { ...this.document, visualsVisible: next };
    this.notifyDocument();
  }

  subscribe<TState = unknown>(
    id: string,
    subscriber: ChartRuntimeAddonStateSubscriber<TState>,
  ): () => void {
    const key = keyOf(id);
    const set = this.subscribers.get(key) ?? new Set();
    set.add(subscriber as ChartRuntimeAddonStateSubscriber<any>);
    this.subscribers.set(key, set);
    return () => {
      set.delete(subscriber as ChartRuntimeAddonStateSubscriber<any>);
      if (!set.size) this.subscribers.delete(key);
    };
  }

  subscribeDocument(
    subscriber: (document: ChartRuntimeAddonStateDocument) => void,
  ): () => void {
    this.documentSubscribers.add(subscriber);
    return () => this.documentSubscribers.delete(subscriber);
  }

  private notify(key: string): void {
    const snapshot = this.snapshot();
    const node = snapshot.addons[key];
    for (const subscriber of [...(this.subscribers.get(key) ?? [])]) {
      subscriber(node, snapshot);
    }
    for (const subscriber of [...this.documentSubscribers]) subscriber(snapshot);
  }

  private notifyDocument(): void {
    const snapshot = this.snapshot();
    for (const subscriber of [...this.documentSubscribers]) subscriber(snapshot);
  }

  private notifyAll(): void {
    const snapshot = this.snapshot();
    for (const [key, subscribers] of this.subscribers) {
      const node = snapshot.addons[key];
      for (const subscriber of [...subscribers]) subscriber(node, snapshot);
    }
    for (const subscriber of [...this.documentSubscribers]) subscriber(snapshot);
  }
}

export function createChartRuntimeAddonStateStore(
  initial?: ChartRuntimeAddonStateDocument,
): ChartRuntimeAddonStateStore {
  return new ChartRuntimeAddonStateStoreImpl(initial);
}
