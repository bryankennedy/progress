// The command layer's tiny event bus. Keyboard shortcuts, buttons, and the
// palette itself all open overlays through these functions, so callers don't
// need a React context to reach the singleton palette/dialog in CommandLayer.

export type PaletteMode =
  | { kind: "root"; actionId: string | null }
  | {
      kind: "status" | "priority" | "estimate" | "move" | "tag" | "arc" | "due" | "workon";
      actionId: string;
    };

export type CreateDefaults = {
  focusId?: string;
  arcId?: string | null;
};

type Listener<T> = (value: T) => void;

function channel<T>() {
  const listeners = new Set<Listener<T>>();
  return {
    emit: (value: T) => {
      for (const listener of listeners) listener(value);
    },
    on: (listener: Listener<T>) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
  };
}

const palette = channel<PaletteMode>();
export const openPalette = palette.emit;
export const onOpenPalette = palette.on;

// The `/` search modal (PROG-130) — a search-only surface, separate from the
// ⌘K command palette. Opens with an optional initial query (the search page's
// box can hand off its text). The void payload just triggers an open.
const search = channel<string | undefined>();
export const openSearch = (initialQuery?: string) => search.emit(initialQuery);
export const onOpenSearch = search.on;

const create = channel<CreateDefaults | undefined>();
// Defaults omitted → the dialog derives its container from the current route.
export const openCreateAction = (defaults?: CreateDefaults) => create.emit(defaults);
export const onOpenCreateAction = create.on;

export type ContainerDialogRequest =
  | { kind: "workspace" }
  | { kind: "focus"; workspaceId?: string }
  | { kind: "arc"; focusId?: string };

const createContainer = channel<ContainerDialogRequest>();
// Parent omitted → the dialog derives it from the current route.
export const openCreateContainer = createContainer.emit;
export const onOpenCreateContainer = createContainer.on;
