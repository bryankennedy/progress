// The command layer's tiny event bus. Keyboard shortcuts, buttons, and the
// palette itself all open overlays through these functions, so callers don't
// need a React context to reach the singleton palette/dialog in CommandLayer.

export type PaletteMode =
  | { kind: "root"; issueId: string | null }
  | {
      kind: "status" | "priority" | "estimate" | "move" | "tag" | "arc" | "due" | "workon";
      issueId: string;
    };

export type CreateDefaults = {
  productId?: string;
  repoId?: string | null;
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

const create = channel<CreateDefaults | undefined>();
// Defaults omitted → the dialog derives its container from the current route.
export const openCreateIssue = (defaults?: CreateDefaults) => create.emit(defaults);
export const onOpenCreateIssue = create.on;

export type ContainerDialogRequest =
  | { kind: "initiative" }
  | { kind: "product"; initiativeId?: string }
  | { kind: "repo"; productId?: string }
  | { kind: "arc"; productId?: string };

const createContainer = channel<ContainerDialogRequest>();
// Parent omitted → the dialog derives it from the current route.
export const openCreateContainer = createContainer.emit;
export const onOpenCreateContainer = createContainer.on;
