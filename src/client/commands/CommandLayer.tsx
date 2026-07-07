// One mount point for the command layer: global keyboard shortcuts,
// current-issue tracking, the command palette, and the create-issue dialog.

import { useEffect } from "react";
import type { SnapshotPayload } from "../../shared/types";
import CommandPalette from "./CommandPalette";
import CreateContainerDialog from "./CreateContainerDialog";
import CreateIssueDialog from "./CreateIssueDialog";
import SearchModal from "./SearchModal";
import { initCurrentIssueTracking } from "./currentIssue";
import { useGlobalKeys } from "./useGlobalKeys";

export default function CommandLayer({ snapshot }: { snapshot: SnapshotPayload }) {
  useEffect(initCurrentIssueTracking, []);
  useGlobalKeys();
  return (
    <>
      <CommandPalette snapshot={snapshot} />
      <SearchModal snapshot={snapshot} />
      <CreateIssueDialog snapshot={snapshot} />
      <CreateContainerDialog snapshot={snapshot} />
    </>
  );
}
