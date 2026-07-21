export type FileBrowserEntryKind = "directory" | "file";
export type FileBrowserEntryIcon = "environment" | "file" | "folder";
export type FileBrowserEntryAction = "navigate" | "select";

export interface FileBrowserEntry {
  readonly name: string;
  readonly path: string;
  readonly kind: FileBrowserEntryKind;
  readonly action: FileBrowserEntryAction;
  readonly detail: string;
  readonly icon: FileBrowserEntryIcon;
  readonly disabled?: boolean;
}

export interface FileBrowserListing {
  readonly path: string;
  readonly parentPath?: string;
  readonly entries: readonly FileBrowserEntry[];
}

export interface FileBrowserLoadRequest {
  readonly path?: string;
  readonly includeHidden: boolean;
}

export interface FileBrowserSource {
  load(request: FileBrowserLoadRequest): Promise<FileBrowserListing>;
}

export interface FileBrowserOptions {
  readonly title: string;
  readonly description: string;
  readonly confirmLabel: string;
  readonly selectionTitle: string;
  readonly emptySelectionTitle: string;
  readonly emptySelectionDescription: string;
  readonly selectionIcon: FileBrowserEntryIcon;
  readonly source: FileBrowserSource;
  readonly initialPath?: string;
  readonly includeHidden?: boolean;
  readonly allowHiddenToggle?: boolean;
  readonly onConfirm: (path: string) => void | Promise<void>;
}

export interface FileBrowserSnapshot {
  readonly open: boolean;
  readonly loading: boolean;
  readonly filter: string;
  readonly includeHidden: boolean;
  readonly allowHiddenToggle: boolean;
  readonly selectedPath?: string;
  readonly listing?: FileBrowserListing;
  readonly visibleEntries: readonly FileBrowserEntry[];
  readonly options?: FileBrowserOptions;
}

export class FileBrowserController {
  private options: FileBrowserOptions | undefined;
  private listing: FileBrowserListing | undefined;
  private selectedPath: string | undefined;
  private filter = "";
  private includeHidden = false;
  private loading = false;
  private openState = false;
  private requestVersion = 0;
  private visibleEntriesCache: readonly FileBrowserEntry[] = [];
  private visibleEntriesCacheListing: FileBrowserListing | undefined;
  private visibleEntriesCacheFilter = "";

  constructor(private readonly onChange: () => void) {}

  snapshot(): FileBrowserSnapshot {
    const normalizedFilter = this.filter.trim().toLocaleLowerCase();
    if (
      this.visibleEntriesCacheListing !== this.listing
      || this.visibleEntriesCacheFilter !== normalizedFilter
    ) {
      this.visibleEntriesCache = normalizedFilter
        ? (this.listing?.entries ?? []).filter(
            (entry) => entry.name.toLocaleLowerCase().includes(normalizedFilter),
          )
        : (this.listing?.entries ?? []);
      this.visibleEntriesCacheListing = this.listing;
      this.visibleEntriesCacheFilter = normalizedFilter;
    }
    return {
      open: this.openState,
      loading: this.loading,
      filter: this.filter,
      includeHidden: this.includeHidden,
      allowHiddenToggle: this.options?.allowHiddenToggle === true,
      ...(this.selectedPath ? { selectedPath: this.selectedPath } : {}),
      ...(this.listing ? { listing: this.listing } : {}),
      visibleEntries: this.visibleEntriesCache,
      ...(this.options ? { options: this.options } : {}),
    };
  }

  async open(options: FileBrowserOptions): Promise<void> {
    this.options = options;
    this.openState = true;
    this.filter = "";
    this.selectedPath = undefined;
    this.includeHidden = options.includeHidden === true;
    await this.load(options.initialPath);
  }

  close(): void {
    this.requestVersion += 1;
    this.options = undefined;
    this.listing = undefined;
    this.selectedPath = undefined;
    this.filter = "";
    this.includeHidden = false;
    this.loading = false;
    this.openState = false;
    this.onChange();
  }

  async navigate(path?: string): Promise<void> {
    if (!this.options) return;
    this.filter = "";
    this.selectedPath = undefined;
    await this.load(path);
  }

  async activate(path: string): Promise<void> {
    const entry = this.listing?.entries.find((candidate) => candidate.path === path);
    if (!entry || entry.disabled) return;
    if (entry.action === "navigate") {
      await this.navigate(entry.path);
      return;
    }
    this.selectedPath = entry.path;
    this.onChange();
  }

  setFilter(filter: string): void {
    this.filter = filter;
    this.onChange();
  }

  async setIncludeHidden(includeHidden: boolean): Promise<void> {
    if (!this.options || !this.options.allowHiddenToggle) return;
    this.includeHidden = includeHidden;
    await this.load(this.listing?.path);
  }

  async confirm(): Promise<void> {
    const options = this.options;
    const selectedPath = this.selectedPath;
    if (!options || !selectedPath) return;
    await options.onConfirm(selectedPath);
    this.close();
  }

  private async load(path?: string): Promise<void> {
    const options = this.options!;
    const version = ++this.requestVersion;
    this.loading = true;
    this.onChange();
    try {
      const listing = await options.source.load({
        ...(path ? { path } : {}),
        includeHidden: this.includeHidden,
      });
      if (version !== this.requestVersion) return;
      this.listing = listing;
      this.selectedPath = undefined;
    } finally {
      if (version === this.requestVersion) {
        this.loading = false;
        this.onChange();
      }
    }
  }
}
