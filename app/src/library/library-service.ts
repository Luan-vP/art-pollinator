/**
 * LibraryService — the use case behind issue #38's library screen ("list
 * all slots (both locked and swappable) with their content, and lock/unlock
 * controls per item"). `@art-pollinator/app`'s own package doc comment has
 * named this class since Phase 1a ("use cases (SwapService,
 * LibraryService)") — this is the first batch that actually builds it.
 *
 * ## Design: an in-memory `Library` snapshot with subscribable mutation, not a repository wrapper
 *
 * `core`'s `Library` (`@art-pollinator/core`) is already a plain,
 * immutable value with pure `lockItem`/`unlockItem`/`addItem`/`removeItem`
 * functions (`../library/library.ts`'s own doc comment: "a plain
 * structurally-typed immutable snapshot"). What's missing for a UI to use
 * it is somewhere to *hold* the current snapshot across renders and a way
 * to be notified when it changes — exactly what a React `useState`/context
 * would do for one screen, except `SwapService` (running independently,
 * possibly triggered by a background discovery loop) *also* needs to read
 * and update the same current `Library`, so the holder can't be
 * screen-local state. `LibraryService` is that single shared holder: it
 * wraps a `Library` value, applies `core`'s pure operations to it, and
 * notifies subscribers — same "hold state, notify on change" shape
 * `SwapActivityLog` already uses for swap outcomes (`../swap/swap-activity-log.js`),
 * just holding a single current value instead of an append-only history.
 *
 * ## Design: initial state loads from `MetadataRepositoryPort`, mutations don't always persist there
 *
 * `LibraryService.create` loads every token `metadataRepository.listAll()`
 * already holds and seeds them into the swappable pool (SPEC.md §3.3:
 * "incoming pieces land here") — this is how a device's library survives
 * *its own* restart, layered on top of whatever `MetadataRepositoryPort`
 * adapter the composition root wired in (in-memory fake or a real one).
 * `lockItem`/`unlockItem` only change which pool an item occupies — SPEC.md
 * §3.3 has no concept of a repository row recording lock state, so these do
 * not call back out to `metadataRepository`; `addItem`/`removeItem` *do*
 * persist (a new item this device didn't have before, or one being dropped,
 * is exactly a repository-level change). `SwapService` continues to call
 * `metadataRepository.save` itself for items it accepts (that responsibility
 * doesn't move here) — a composition root wiring both against the *same*
 * `metadataRepository` instance keeps them consistent.
 */
import {
  EMPTY_LIBRARY,
  addItem,
  lockItem,
  removeItem,
  toPriority,
  unlockItem,
  type Library,
  type LibraryOperationResult,
  type MetadataRepositoryPort,
  type MetadataToken,
} from "@art-pollinator/core";

export type LibraryChangeListener = (library: Library) => void;

export class LibraryService {
  private library: Library;
  private readonly listeners = new Set<LibraryChangeListener>();

  private constructor(
    private readonly metadataRepository: MetadataRepositoryPort,
    initialLibrary: Library,
  ) {
    this.library = initialLibrary;
  }

  /** Construct a `LibraryService`, seeding its initial state from every token `metadataRepository` already holds. */
  static async create(metadataRepository: MetadataRepositoryPort): Promise<LibraryService> {
    const persisted = await metadataRepository.listAll();
    let library = EMPTY_LIBRARY;
    for (const token of persisted) {
      const result = addItem(library, token, toPriority(0));
      // A persisted repository should never already exceed swappable
      // capacity (issue #23 dedup + the swap-side eviction path keep the
      // repository and library in step) — surfacing a loud error here
      // rather than silently dropping a token is still the safer default if
      // that invariant is ever violated.
      if (!result.ok) {
        throw new Error(`LibraryService.create: failed to seed persisted token: ${result.error}`);
      }
      library = result.library;
    }
    return new LibraryService(metadataRepository, library);
  }

  /**
   * Construct a `LibraryService` that starts from an empty `Library`
   * without reading `metadataRepository` first — for a composition root
   * that already knows its repository is a fresh, empty instance (e.g. the
   * in-memory fake constructed fresh at app start-up), where the async
   * {@link create}'s `listAll()` round trip would just be an empty no-op.
   * Kept synchronous specifically so a composition root's factory function
   * doesn't itself need to become `async` just to build one of these (issue
   * #37 — see `clients/mobile/src/composition/composition-root-shared.ts`).
   */
  static createEmpty(metadataRepository: MetadataRepositoryPort): LibraryService {
    return new LibraryService(metadataRepository, EMPTY_LIBRARY);
  }

  /** The current `Library` snapshot. */
  getLibrary(): Library {
    return this.library;
  }

  /**
   * Replace the entire in-memory `Library` snapshot and notify subscribers
   * — for adopting a `Library` a `SwapService.swap()` call already computed
   * and (for accepted items) persisted. Does not itself touch
   * `metadataRepository`; `SwapService` already saved whatever it accepted
   * before returning the outcome this method is handed (see
   * `../swap/swap-service.ts`'s transfer step) — this only updates what
   * *this* service's own subscribers (a library screen) see.
   */
  adoptLibrary(library: Library): void {
    this.library = library;
    for (const listener of this.listeners) {
      listener(this.library);
    }
  }

  /** Subscribe to every future change. Returns a function that unsubscribes. Not replayed — call {@link getLibrary} first for the current state. */
  subscribe(listener: LibraryChangeListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private applyResult(result: LibraryOperationResult): LibraryOperationResult {
    if (result.ok) {
      this.library = result.library;
      for (const listener of this.listeners) {
        listener(this.library);
      }
    }
    return result;
  }

  /** Lock an item (moves it into the lockable pool — never evicted, never offered). See `core`'s `lockItem` for rejection cases (already locked, pool full, absent item). */
  lock(contentHash: string): LibraryOperationResult {
    return this.applyResult(lockItem(this.library, contentHash));
  }

  /** Unlock an item (moves it back into the swappable pool). See `core`'s `unlockItem` for rejection cases. */
  unlock(contentHash: string): LibraryOperationResult {
    return this.applyResult(unlockItem(this.library, contentHash));
  }

  /** Add a new item — persists to `metadataRepository`, then applies `core`'s `addItem` to the in-memory snapshot. */
  async add(token: MetadataToken): Promise<LibraryOperationResult> {
    const result = addItem(this.library, token, toPriority(0));
    if (result.ok) {
      await this.metadataRepository.save(token);
    }
    return this.applyResult(result);
  }

  /** Remove an item — applies `core`'s `removeItem`, then deletes from `metadataRepository`. */
  async remove(contentHash: string): Promise<LibraryOperationResult> {
    const result = removeItem(this.library, contentHash);
    if (result.ok) {
      await this.metadataRepository.delete(contentHash);
    }
    return this.applyResult(result);
  }
}
