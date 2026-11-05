import type { BoardAddressee } from "@shephrd/contracts/board/ids";
import type { BoardChannelView } from "@shephrd/contracts/board/view";
import type { Snapshot } from "../commands/internal.ts";
import { boardView, sameAuthor } from "./wake.ts";

export const transferName = (snapshot: Snapshot, channel: BoardChannelView, manager: BoardAddressee, label: string) => {
  const ownName = channel.ownName ?? channel.name;
  const prefix = label.replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^[^a-zA-Z]+/, "") || "agent";
  const occupied = new Set(Object.values(boardView(snapshot).channels)
    .filter((row) => row.channelId !== channel.channelId && row.manager !== undefined && sameAuthor(row.manager, manager)).map((row) => row.name));
  for (let suffix = 0; ; suffix++) {
    const tail = suffix === 0 ? "" : `-${suffix}`;
    // Prefer the whole own name. Only its display is shortened when a single
    // prefix letter, separator and collision suffix leave insufficient room.
    const base = ownName.slice(0, 64 - 2 - tail.length);
    const lead = prefix.slice(0, 64 - 1 - base.length - tail.length);
    const name = `${lead}-${base}${tail}`;
    if (!occupied.has(name)) return { name, ownName };
  }
};
