import { app } from "electron";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type SubAgentSessionLinkSource = "runtime" | "migration";

export interface SubAgentSessionLink {
  childSessionPath: string;
  parentSessionPath: string;
  correlationId?: string;
  source: SubAgentSessionLinkSource;
  updatedAt: number;
}

interface DiskRegistryFile {
  version: number;
  links: Record<string, SubAgentSessionLink>;
}

const DISK_SCHEMA_VERSION = 1;
const SAVE_DEBOUNCE_MS = 800;

/**
 * PiDeck-owned child-session registry.
 *
 * The teammate runtime exposes authoritative child files while it is running,
 * but that relationship is not persisted in pi's JSONL format. Keeping the
 * link in userData lets later history scans avoid treating generic fork
 * metadata as proof that a session is a sub-agent.
 */
export class SubAgentSessionRegistry {
  private readonly links = new Map<string, SubAgentSessionLink>();
  private readonly filePath: string;
  private loaded = false;
  private loadPromise: Promise<void> | null = null;
  private saveTimer: NodeJS.Timeout | null = null;
  private saving: Promise<void> | null = null;
  private dirty = false;
  private revision = 0;

  constructor(fileName = "subagent-session-links.json") {
    this.filePath = join(app.getPath("userData"), fileName);
  }

  async ensureLoaded(): Promise<void> {
    if (this.loaded) return;
    if (this.loadPromise) return this.loadPromise;
    this.loadPromise = this.loadFromDisk()
      .catch(() => {
        // Missing or damaged registry is a cache miss; history migration can rebuild it.
      })
      .finally(() => {
        this.loaded = true;
      });
    return this.loadPromise;
  }

  get(childSessionPath: string): SubAgentSessionLink | undefined {
    return this.links.get(normalizeSessionPath(childSessionPath));
  }

  async record(input: Omit<SubAgentSessionLink, "updatedAt">): Promise<void> {
    await this.ensureLoaded();
    const childKey = normalizeSessionPath(input.childSessionPath);
    const parentKey = normalizeSessionPath(input.parentSessionPath);
    if (!childKey || !parentKey || childKey === parentKey) return;

    const previous = this.links.get(childKey);
    const next: SubAgentSessionLink = {
      ...input,
      updatedAt: Date.now(),
    };
    if (
      previous &&
      normalizeSessionPath(previous.parentSessionPath) === parentKey &&
      previous.correlationId === next.correlationId &&
      previous.source === next.source
    ) {
      return;
    }
    this.links.set(childKey, next);
    this.markDirty();
  }

  /** Remove stale links owned by one of the roots scanned in this pass. */
  prune(keepPaths: Iterable<string>, scanRoots: Iterable<string>): void {
    const keep = new Set([...keepPaths].map(normalizeSessionPath));
    const roots = [...scanRoots].map(normalizeSessionPath);
    let removed = false;
    for (const [key, link] of this.links) {
      const ownedByCurrentScan = roots.some((root) => key === root || key.startsWith(`${root}/`));
      if (!ownedByCurrentScan) continue;
      if (!keep.has(key) || !keep.has(normalizeSessionPath(link.parentSessionPath))) {
        this.links.delete(key);
        removed = true;
      }
    }
    if (removed) this.markDirty();
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer);
      this.saveTimer = null;
    }
    await this.saveToDisk();
  }

  private markDirty(): void {
    this.dirty = true;
    this.revision += 1;
    if (this.saveTimer) clearTimeout(this.saveTimer);
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null;
      void this.saveToDisk();
    }, SAVE_DEBOUNCE_MS);
    this.saveTimer.unref?.();
  }

  private async loadFromDisk(): Promise<void> {
    const parsed = JSON.parse(await readFile(this.filePath, "utf8")) as DiskRegistryFile;
    if (!parsed || parsed.version !== DISK_SCHEMA_VERSION || !parsed.links) return;
    for (const link of Object.values(parsed.links)) {
      if (!isValidLink(link)) continue;
      this.links.set(normalizeSessionPath(link.childSessionPath), link);
    }
  }

  private async saveToDisk(): Promise<void> {
    if (!this.dirty) return;
    if (this.saving) {
      await this.saving;
      if (!this.dirty) return;
    }
    this.saving = this.writeAtomic().finally(() => {
      this.saving = null;
    });
    await this.saving;
  }

  private async writeAtomic(): Promise<void> {
    try {
      const revisionAtStart = this.revision;
      const links: Record<string, SubAgentSessionLink> = {};
      for (const [key, link] of this.links) links[key] = link;
      const dir = dirname(this.filePath);
      await mkdir(dir, { recursive: true });
      const tempPath = `${this.filePath}.${process.pid}.tmp`;
      await writeFile(tempPath, JSON.stringify({ version: DISK_SCHEMA_VERSION, links }), "utf8");
      await rename(tempPath, this.filePath);
      // A record may arrive while the asynchronous write is in flight. Only
      // clear dirty when the snapshot still represents the latest revision.
      if (this.revision === revisionAtStart) this.dirty = false;
    } catch {
      // Registry loss only causes a future migration; never fail the session workflow.
    }
  }
}

export function normalizeSessionPath(value: string): string {
  const normalized = value.replace(/\\/g, "/").replace(/\/+$/, "");
  return isCaseInsensitivePath(normalized) ? normalized.toLowerCase() : normalized;
}

function isCaseInsensitivePath(value: string): boolean {
  return /^[A-Za-z]:\//.test(value) || value.startsWith("//") || /^\/mnt\/[A-Za-z](?:\/|$)/.test(value);
}

function isValidLink(value: unknown): value is SubAgentSessionLink {
  if (!value || typeof value !== "object") return false;
  const link = value as Partial<SubAgentSessionLink>;
  return typeof link.childSessionPath === "string" &&
    Boolean(link.childSessionPath) &&
    typeof link.parentSessionPath === "string" &&
    Boolean(link.parentSessionPath) &&
    (link.correlationId === undefined || typeof link.correlationId === "string") &&
    (link.source === "runtime" || link.source === "migration") &&
    typeof link.updatedAt === "number";
}
