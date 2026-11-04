import type { PieceNamespace } from "@shephrd/contracts";

export interface PieceView {
  readonly empty: () => unknown;
  readonly reduce: (view: unknown, event: Readonly<Record<string, unknown>>, sequence: number) => unknown;
}
const empty = (): unknown => ({});
const reduce: PieceView["reduce"] = (view) => view;
export const pieceViews: Record<PieceNamespace, PieceView> = {
  client: { empty: () => ({}), reduce: (view, event) => {
    const state = view as import("../client/settings.ts").ClientWebView;
    if (event._tag === "client.WebSettingsChanged") return { ...state, webSettings: event.settings };
    if (event._tag === "client.WebServerDown") return { ...state, webDown: true };
    if (event._tag === "client.WebServerUp") return { ...state, webDown: false };
    return view;
  } }, board: { empty, reduce }, roles: { empty, reduce },
};
