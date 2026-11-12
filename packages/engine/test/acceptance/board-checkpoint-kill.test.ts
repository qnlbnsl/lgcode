import { writeFileSync } from "node:fs";
import { afterEach, expect } from "@effect/vitest";
import * as Effect from "effect/Effect";
import { eventsUntil, isTag, plantDatabaseFault, requestId, runSql, scenario, since, stopAllServices } from "../support/acceptance.ts";
import { registerRebuildCheck } from "../support/rebuildCheck.ts";

registerRebuildCheck({ noLog: true });
afterEach(async () => { await stopAllServices(); });

for (const checkpoint of ["trigger", "reminder-queued", "reminder-accepted", "answer-turn-end", "answer-turn-error", "notice-queued", "notice-accepted"] as const) {
  scenario(`SIGKILL after the complete ${checkpoint} batch recovers each board duty without another logical reminder or notice`, (w) => Effect.gen(function* () {
    yield* w.owner["roles.settings.set"]({ requestId: requestId(), settings: { stallWatch: false } } as never);
    const originalGate = `${w.root.root}/original`;
    const reminderGate = `${w.root.root}/reminder`;
    const noticeGate = `${w.root.root}/notice`;
    const asker = yield* w.start(w.owner, { name: "Checkpoint asker", prompt: "Ready.", script: { turns: [[], [
      { step: "tool_call", toolCallId: "checkpoint", title: "Taking the notice.", kind: "think", status: "completed", output: "Ready." }, { step: "wait_for_file", path: noticeGate },
    ]] } });
    const target = yield* w.start(w.owner, { name: "Checkpoint target", prompt: "Ready.", script: { turns: [[], [
      { step: "tool_call", toolCallId: "checkpoint", title: "Taking the question.", kind: "think", status: "completed", output: "Ready." }, { step: "wait_for_file", path: originalGate },
    ], [
      { step: "tool_call", toolCallId: "checkpoint", title: "Taking the reminder.", kind: "think", status: "completed", output: "Ready." }, { step: "wait_for_file", path: reminderGate },
      ...(checkpoint === "answer-turn-error" ? [{ step: "rpc_error", message: "Checkpoint ordinary failure." }] : []),
    ]] } });
    for (const id of [asker.agentId, target.agentId]) yield* eventsUntil(w.owner, 0, "startup completed", isTag("TurnEnded", id));
    const askerClient = yield* w.asAgent((yield* w.token(asker)).token);
    const channelId = (yield* w.owner["board.open"]({ requestId: requestId(), name: "checkpoint" } as never)).channelId;
    yield* w.owner["board.members"]({ requestId: requestId(), channelId, add: [asker.agentId, target.agentId], remove: [] } as never);
    const before = yield* w.watermark();
    const postId = (yield* askerClient["board.post"]({ requestId: requestId(), channelId, text: "Please decide.", to: [{ _tag: "agent", agentId: target.agentId }], reply: "all" } as never)).postId;
    const accepted = yield* eventsUntil(w.owner, before, "original question accepted", isTag("DeliveryAccepted", target.agentId));
    const originalId = (accepted.at(-1)!.event as { deliveryId: string }).deliveryId;
    // Faults stop the next complete transaction, never create a checkpoint
    // inside an atomic batch. They are removed from the stopped database.
    const fault = (condition: string) => plantDatabaseFault(w.root,
      `CREATE TRIGGER checkpoint_stop BEFORE INSERT ON events WHEN ${condition} BEGIN SELECT RAISE(ABORT, 'checkpoint boundary'); END`, "");
    if (checkpoint === "trigger") fault("NEW.event_type = 'board.WakeBuilt' AND json_array_length(json_extract(NEW.payload_json, '$.reminders')) > 0");
    if (checkpoint === "reminder-queued") fault(`NEW.event_type = 'DeliverySent' AND json_extract(NEW.payload_json, '$.agentId') = '${target.agentId}'`);
    const afterOriginalAccept = yield* w.watermark();
    writeFileSync(originalGate, "go");
    if (checkpoint === "trigger") yield* eventsUntil(w.owner, afterOriginalAccept, "original response turn ended", isTag("TurnEnded", target.agentId));
    else {
      const reminderBuilt = yield* eventsUntil(w.owner, afterOriginalAccept, "reminder committed", (row) => row.event._tag === "board.WakeBuilt" && row.event.reminders.includes(postId));
      const reminderId = (reminderBuilt.at(-1)!.event as { wakeId: string }).wakeId;
      if (checkpoint === "reminder-queued") yield* eventsUntil(w.owner, afterOriginalAccept, "reminder queued", (row) => row.event._tag === "DeliveryQueued"
        && row.event.delivery.source?._tag === "piece" && row.event.delivery.source.id === reminderId);
      else {
        const reminderAccepted = yield* eventsUntil(w.owner, afterOriginalAccept, "reminder accepted", (row) => row.event._tag === "DeliveryAccepted" && row.event.agentId === target.agentId && row.event.deliveryId !== originalId);
        const deliveryId = (reminderAccepted.at(-1)!.event as { deliveryId: string }).deliveryId;
        if (checkpoint !== "reminder-accepted") {
          if (checkpoint === "answer-turn-end" || checkpoint === "answer-turn-error") fault("NEW.event_type = 'board.AddresseeResolved' AND json_extract(NEW.payload_json, '$.disposition') = 'no-answer'");
          if (checkpoint === "notice-queued") fault(`NEW.event_type = 'DeliverySent' AND json_extract(NEW.payload_json, '$.agentId') = '${asker.agentId}'`);
          const afterReminderAccept = yield* w.watermark();
          writeFileSync(reminderGate, "go");
          if (checkpoint === "answer-turn-end") yield* eventsUntil(w.owner, afterReminderAccept, "reminder response turn ended", isTag("TurnEnded", target.agentId));
          else if (checkpoint === "answer-turn-error") yield* eventsUntil(w.owner, afterReminderAccept, "accepted reminder error committed", (row) => row.event._tag === "DeliveryReturned" && row.event.deliveryId === deliveryId);
          else {
            const noticeBuilt = yield* eventsUntil(w.owner, afterReminderAccept, "no-answer notice built", (row) => row.event._tag === "board.WakeBuilt" && row.event.noAnswers.some((notice) => notice.postId === postId));
            const noticeId = (noticeBuilt.at(-1)!.event as { wakeId: string }).wakeId;
            const noticeQueued = yield* eventsUntil(w.owner, afterReminderAccept, "no-answer notice queued", (row) => row.event._tag === "DeliveryQueued" && row.event.delivery.source?._tag === "piece" && row.event.delivery.source.id === noticeId);
            const noticeDelivery = (noticeQueued.at(-1)!.event as { delivery: { id: string } }).delivery.id;
            if (checkpoint === "notice-accepted") yield* eventsUntil(w.owner, afterReminderAccept, "no-answer notice accepted", (row) => row.event._tag === "DeliveryAccepted" && row.event.deliveryId === noticeDelivery);
          }
        }
      }
    }
    expect((yield* w.kill("SIGKILL")).signal).toBe("SIGKILL");
    runSql(w.root, "DROP TRIGGER IF EXISTS checkpoint_stop");
    for (const path of [originalGate, reminderGate, noticeGate]) writeFileSync(path, "go");
    yield* w.boot();
    // Recovery carry-on and any previously unsent wake may finish immediately.
    // Read from before the kill and wait through the notice's acceptance.
    const wakeIds = new Set<string>();
    const noticeDeliveries = new Set<string>();
    yield* eventsUntil(w.owner, before, "one no-answer notice accepted across recovery", (row) => {
      if (row.event._tag === "board.WakeBuilt" && row.event.noAnswers.some((notice) => notice.postId === postId)) wakeIds.add(row.event.wakeId);
      if (row.event._tag === "DeliveryQueued" && row.event.delivery.source?._tag === "piece" && wakeIds.has(row.event.delivery.source.id)) noticeDeliveries.add(row.event.delivery.id);
      return row.event._tag === "DeliveryAccepted" && noticeDeliveries.has(row.event.deliveryId);
    });
    const history = yield* since(w.owner, before);
    const reminders = history.filter((row) => row.event._tag === "board.WakeBuilt" && row.event.reminders.includes(postId));
    expect(reminders).toHaveLength(1);
    expect(history.filter((row) => row.event._tag === "board.AddresseeResolved" && row.event.postId === postId && row.event.disposition === "no-answer")).toHaveLength(1);
    expect(history.filter((row) => row.event._tag === "board.WakeBuilt" && row.event.noAnswers.some((notice) => notice.postId === postId))).toHaveLength(1);
    expect(history.filter((row) => row.event._tag === "DeliveryAccepted" && noticeDeliveries.has(row.event.deliveryId))).toHaveLength(1);
    const status = yield* w.owner["board.status"]({ requestId: requestId(), agentId: target.agentId } as never);
    expect(status).toMatchObject({ holdsUnsettled: false, incomingOpen: 1 });
  }));
}
