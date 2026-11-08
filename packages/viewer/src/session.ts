import type { ClientEnvelope } from "@lgcode/client";
import type { ViewerClient } from "./connection.ts";

export type Snapshot = Awaited<ReturnType<ViewerClient["snapshot"]>>;
export type RequestRow = Snapshot["requests"][number] & { readonly kind: "permission" | "question" };

// Own the snapshot/stream race here, rather than in keyboard callbacks. A late
// page from the previously selected agent must never replace the open thread.
export class ViewerSession {
  snapshot: Snapshot | undefined;
  selectedAgentId: string | undefined;
  items: ReadonlyArray<ClientEnvelope> = [];
  loading = false;
  error: string | undefined;
  private generation = 0;
  private stopped = false;
  private refreshPending = false;
  private refreshing: Promise<void> | undefined;
  private stream: AbortController | undefined;
  private streaming: Promise<void> | undefined;

  readonly client: ViewerClient;
  private readonly changed: () => void;

  constructor(client: ViewerClient, changed: () => void) { this.client = client; this.changed = changed; }

  get requests(): ReadonlyArray<RequestRow> {
    return [
      ...(this.snapshot?.requests ?? []).map((row) => ({ ...row, kind: "permission" as const })),
      ...(this.snapshot?.questions ?? []).map((row) => ({ ...row, kind: "question" as const })),
    ].filter((row) => row.agentId === this.selectedAgentId && row.holder._tag === "owner");
  }

  async start(): Promise<void> {
    this.stream?.abort();
    await this.streaming;
    this.error = undefined;
    const selected = this.selectedAgentId;
    await this.refresh();
    if (this.stopped || this.snapshot === undefined) return;
    const after = this.snapshot.sequence;
    // A snapshot contains current state, not the conversation missed while
    // disconnected. Re-read the selected thread before replaying from this
    // anchor; events produced during paging will then arrive on the stream.
    if (selected !== undefined && selected === this.selectedAgentId) await this.select(selected);
    const controller = new AbortController();
    this.stream = controller;
    this.streaming = this.client.subscribe(after, (item) => {
      if (controller.signal.aborted || this.stopped) return;
      if ("event" in item) {
        this.append(item as ClientEnvelope);
        if (item.event?._tag !== "ThreadItem") void this.refresh().catch(() => this.fail("The roster could not be refreshed. Press r to retry."));
      } else if ("tag" in item) {
        // Recover the full event so settled sources survive snapshot refresh.
        void this.client.event({ sequence: item.sequence }).then((reply) => {
          if (!controller.signal.aborted) {
            this.append(reply.envelope);
            if (reply.envelope.event._tag !== "ThreadItem") void this.refresh().catch(() => this.fail("The roster could not be refreshed. Press r to retry."));
          }
        }).catch(() => this.fail("A live event could not be read. Press r to reload."));
      }
    }, controller.signal).then(() => {
      if (!controller.signal.aborted) this.fail("The live stream ended. Press r to reconnect.");
    }, () => {
      if (!controller.signal.aborted) this.fail("The live connection stopped. Press r to reconnect.");
    });
    this.changed();
  }

  private fail(message: string): void {
    if (this.stopped) return;
    this.error = message;
    this.changed();
  }

  refresh(): Promise<void> {
    this.refreshPending = true;
    if (this.refreshing !== undefined) return this.refreshing;
    this.refreshing = (async () => {
      while (this.refreshPending && !this.stopped) {
        this.refreshPending = false;
        const snapshot = await this.client.snapshot();
        if (this.stopped) return;
        if (this.snapshot === undefined || snapshot.sequence >= this.snapshot.sequence) this.snapshot = snapshot;
        if (!snapshot.agents.some((agent) => agent.agentId === this.selectedAgentId)) {
          await this.select(snapshot.agents[0]?.agentId);
        }
        this.changed();
      }
    })().finally(() => { this.refreshing = undefined; });
    return this.refreshing;
  }

  private append(item: ClientEnvelope): void {
    const target = item.event._tag === "DeliveryQueued" ? item.event.delivery.target
      : "agentId" in item.event ? item.event.agentId : item.agentId;
    if (this.selectedAgentId === undefined || target !== this.selectedAgentId || this.stopped) return;
    const bySequence = new Map(this.items.map((entry) => [entry.sequence, entry]));
    bySequence.set(item.sequence, item);
    this.items = [...bySequence.values()].sort((a, b) => a.sequence - b.sequence);
    this.changed();
  }

  async select(agentId: string | undefined): Promise<void> {
    const generation = ++this.generation;
    this.selectedAgentId = agentId;
    this.items = [];
    this.loading = agentId !== undefined;
    this.changed();
    if (agentId === undefined) return;
    try {
      let after = 0;
      do {
        const page = await this.client.thread({ agentId, after, limit: 100 });
        if (this.stopped || generation !== this.generation) return;
        for (const item of page.items) this.append(item);
        if (page.next === undefined) break;
        if (page.next <= after) throw new Error("Invalid thread cursor");
        after = page.next;
      } while (true);
    } catch {
      if (generation === this.generation) this.fail("The thread could not be loaded. Press r to retry.");
    } finally {
      if (!this.stopped && generation === this.generation) { this.loading = false; this.changed(); }
    }
  }

  async close(): Promise<void> {
    this.stopped = true;
    this.generation++;
    this.stream?.abort();
    await this.client.close();
    await this.streaming;
  }
}
