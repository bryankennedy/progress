// One mount point for the command layer: global keyboard shortcuts,
// current-action tracking, the command palette, and the create-action dialog.

import { useEffect } from "react";
import type { SnapshotPayload } from "../../shared/types";
import CommandPalette from "./CommandPalette";
import CreateContainerDialog from "./CreateContainerDialog";
import CreateActionDialog from "./CreateActionDialog";
import SearchModal from "./SearchModal";
import { initCurrentActionTracking } from "./currentAction";
import { useGlobalKeys } from "./useGlobalKeys";

export default function CommandLayer({ snapshot }: { snapshot: SnapshotPayload }) {
  useEffect(initCurrentActionTracking, []);
  useGlobalKeys();
  return (
    <>
      <CommandPalette snapshot={snapshot} />
      <SearchModal snapshot={snapshot} />
      <CreateActionDialog snapshot={snapshot} />
      <CreateContainerDialog snapshot={snapshot} />
    </>
  );
}
