import type { EngineLists } from "../pieces/lists.ts";
import { snapshotFor } from "./snapshot.ts";

// Read once during service startup. Restarting without this setting restores
// the reactor, whose initial pass scans the complete rebuilt board view.
export const boardEnabledAtStartup = (environment: NodeJS.ProcessEnv): boolean => environment.SHEPHRD_BOARD_DISABLED !== "1";

export const withBoardEnabled = (lists: EngineLists, enabled: boolean): EngineLists => {
  if (enabled) return lists;
  const { board: _board, ...reactors } = lists.reactors;
  return {
    ...lists, boardEnabled: false,
    holdUnsettled: { ...lists.holdUnsettled, board: () => false },
    requestHeld: { ...lists.requestHeld, board: () => false },
    snapshotSections: { ...lists.snapshotSections, board: (caller, view) => snapshotFor(caller, view, false) },
    reactors,
  };
};
