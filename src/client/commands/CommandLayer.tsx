// One mount point for the command layer: global keyboard shortcuts,
// current-issue tracking, the command palette, and the create-issue dialog.

import { useEffect } from "react";
import type { WorkspacePayload } from "../../shared/types";
import CommandPalette from "./CommandPalette";
import CreateContainerDialog from "./CreateContainerDialog";
import CreateIssueDialog from "./CreateIssueDialog";
import { initCurrentIssueTracking } from "./currentIssue";
import { useGlobalKeys } from "./useGlobalKeys";

export default function CommandLayer({ workspace }: { workspace: WorkspacePayload }) {
  useEffect(initCurrentIssueTracking, []);
  useGlobalKeys();
  return (
    <>
      <CommandPalette workspace={workspace} />
      <CreateIssueDialog workspace={workspace} />
      <CreateContainerDialog workspace={workspace} />
    </>
  );
}
