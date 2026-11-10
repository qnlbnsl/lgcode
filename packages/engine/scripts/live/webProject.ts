import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import type { Page } from "@playwright/test";
import { expect } from "@playwright/test";
import type { Client } from "@lgcode/client";
import { EventEnvelope, type AgentId, type EventSequence, type Project, type RequestId } from "@lgcode/contracts";
import * as Effect from "effect/Effect";
import * as Schema from "effect/Schema";

const id = () => randomUUID() as RequestId;
const run = <A, E>(effect: Effect.Effect<A, E>) => Effect.runPromise(effect);
const answerText = "Use the existing contracts. This is the owner’s durable project decision.";
type Step = (name: string, body: () => Promise<void>) => Promise<void>;

// Actual provider proof. Nothing seeds a project, task, question or provider
// reply. The page creates the project; its real lead must invoke MCP tools.
export async function webProject(page: Page, owner: Client, origin: string, step: Step, remember: (agent: AgentId) => void) {
  let project!: Project;
  let answer: Parameters<Client["answer"]>[0] | undefined;
  const wire = (socket: import("@playwright/test").WebSocket) => socket.on("framesent", ({ payload }) => {
    try {
      const raw = JSON.parse(payload.toString());
      for (const frame of Array.isArray(raw) ? raw : [raw]) {
        if (frame._tag === "Request" && frame.tag === "answer" && frame.payload.kind === "question" && frame.payload.text === answerText) answer = frame.payload;
      }
    } catch { /* Keepalives do not contain an answer. */ }
  });
  page.on("websocket", wire);
  // Reopen the authenticated page so this observer owns every answer socket.
  await page.reload();
  await step("project: first-run discovery reads actual local readiness", async () => {
    await page.getByRole("button", { name: "Get started", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Found on this computer", exact: true })).toBeVisible();
    await expect(page.getByText("Local credential present", { exact: false }).first()).toBeVisible();
  });
  await step("project: first-project form is ready for actual creation", async () => {
    await page.getByRole("button", { name: "Continue", exact: true }).click();
    const form = page.locator(".new-project");
    await expect(form.getByLabel("Goal", { exact: true })).toHaveCount(0);
    await form.getByLabel("Repository", { exact: true }).selectOption("__new");
    await form.getByLabel("Repository name", { exact: true }).fill("web-provider-project");
    await form.getByLabel("Project name", { exact: true }).fill("Actual provider journey");
    await expect(form.getByRole("button", { name: "Create project", exact: true })).toBeEnabled();
  });
  await step("project: first-run page creates the real repository and worktree", async () => {
    await page.getByRole("button", { name: "Create project", exact: true }).click();
    await expect.poll(async () => (await run(owner["client.snapshot"]({ requestId: id() }))).project?.projects.some((row) => row.name === "Actual provider journey")).toBe(true);
    const snapshot = await run(owner["client.snapshot"]({ requestId: id() }));
    project = snapshot.project!.projects.find((row) => row.name === "Actual provider journey")!;
    expect(project).toBeDefined(); remember(project.leadAgentId);
    const worktree = snapshot.project!.workspaces.find((row) => row.worktreeId === project.worktreeId)!;
    expect(worktree.checkout).toBe("worktree");
    expect(execFileSync("git", ["-C", worktree.path, "branch", "--show-current"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()).toBe(worktree.branch);
    expect(execFileSync("git", ["-C", worktree.path, "rev-parse", "--is-inside-work-tree"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()).toBe("true");
  });
  await step("project: first-run completion records the created project and opens its lead", async () => {
    await expect.poll(async () => {
      const snapshot = await run(owner["client.snapshot"]({ requestId: id() }));
      return snapshot.project?.setup?.completedAt !== undefined || snapshot.agents.some((row) => row.agentId === project.leadAgentId && row.startFailure !== undefined);
    }).toBe(true);
    const current = await run(owner["client.snapshot"]({ requestId: id() }));
    if (current.project?.setup?.completedAt === undefined) {
      const failure = current.agents.find((row) => row.agentId === project.leadAgentId)?.startFailure;
      // A bounded recovery keeps the explicitly configured model and effort.
      // It never accepts an alternate-model offer or creates another project.
      expect(["model-refused", "effort-refused"]).toContain(failure);
      await step("project: failed created lead exposes its existing configured remedy", async () => {
        await page.getByRole("button", { name: "Open lead conversation", exact: true }).click();
        const axis = failure === "model-refused" ? "Model" : "Effort";
        await page.getByRole("button", { name: axis, exact: true }).click();
        await page.getByRole("menuitemradio", { name: axis === "Model" ? "gpt-6.1-sol" : "high", exact: true }).click();
        await page.locator(".configuration-evidence > summary").click();
        await expect(page.getByText("Selection recorded.", { exact: false })).toBeVisible();
      });
      await step("project: resume retains the configured model and effort", async () => {
        await page.getByRole("button", { name: "Resume agent", exact: true }).click();
        await expect.poll(async () => {
          const lead = (await run(owner["client.snapshot"]({ requestId: id() }))).agents.find((row) => row.agentId === project.leadAgentId);
          return lead?.startFailure !== undefined ? "failed" : lead?.state._tag === "idle" ? "idle" : "pending";
        }, { timeout: 180_000 }).not.toBe("pending");
        expect((await run(owner["client.snapshot"]({ requestId: id() }))).agents.find((row) => row.agentId === project.leadAgentId)?.state._tag).toBe("idle");
      });
      await step("project: recovered existing lead completes the original first project", async () => {
        await page.getByRole("button", { name: "Return to first project", exact: true }).click();
        await page.getByRole("button", { name: "Retry completion", exact: true }).click();
      });
    }
    await expect(page).toHaveURL(/#\/thread\//);
    const snapshot = await run(owner["client.snapshot"]({ requestId: id() }));
    expect(snapshot.project!.setup?.projectId).toBe(project.projectId);
    expect(snapshot.project!.setup?.completedAt).toBeGreaterThan(0);
  });
  await step("project: actual lead finishes its first turn", async () => {
    await expect.poll(async () => (await run(owner["client.snapshot"]({ requestId: id() }))).agents.find((row) => row.agentId === project.leadAgentId)?.state._tag,
      { timeout: 180_000 }).toBe("idle");
  });
  const anchor = (await run(owner["client.sequence"]({ requestId: id() }))).sequence;
  const events = async (client: Client) => {
    const head = (await run(client["client.sequence"]({ requestId: id() }))).sequence;
    const rows: Array<typeof EventEnvelope.Type> = [];
    for (let sequence = anchor + 1; sequence <= head; sequence++) {
      const reply = await run(client["client.event"]({ requestId: id(), sequence: sequence as EventSequence }));
      if ("envelope" in reply) rows.push(Schema.decodeUnknownSync(EventEnvelope)(reply.envelope));
    }
    return rows;
  };
  await step("project: actual lead creates a linked sprint, task and owner question with supported tools", async () => {
    const prompt = `Use only the installed lgcode MCP tools for this bounded proof, not shell commands or prose pretending to be tools. You are ${project.leadAgentId}, lead of project ${project.projectId}, assigned worktree ${project.worktreeId}. Call project.team.create with projectId, name "Proof team", worktreeId. Call project.sprint.create with projectId, label "LIVE-1", name "Provider decision", goal "Get the owner's linked decision", phase "Plan", owner your agent id, needs []. Call project.task.create with projectId, the returned teamId and sprintId, your worktreeId, owner your agent id, label "LIVE-TASK", title "Choose the existing contracts", state "active". Call ask with projectId, returned taskId and sprintId, title "Provider linked decision", text "May I use the existing contracts?", recommendation "Use the existing contracts". Do not answer it yourself, create other work, or finish the sprint. End your reply after asking. When the owner answer arrives, reply exactly OWNER_DECISION_RECEIVED and do not use tools.`;
    await page.getByRole("form", { name: "Prompt agent", exact: true }).getByRole("textbox").fill(prompt);
    await page.getByRole("button", { name: "Send prompt", exact: true }).click();
    await expect.poll(async () => (await run(owner["client.requests"]({ requestId: id(), after: 0 as EventSequence, limit: 200 }))).items
      .some((row) => row.projectId === project.projectId && row.agentId === project.leadAgentId && row.kind === "question" && row.taskId !== undefined && row.sprintId !== undefined && row.holder._tag === "owner"),
      { timeout: 240_000, intervals: [500, 1_000, 2_000] }).toBe(true);
    const rows = await events(owner);
    for (const tag of ["project.SprintAdded", "project.TaskAdded", "QuestionAsked"]) {
      const matches = rows.filter((row) => row.event._tag === tag);
      expect(matches).toHaveLength(1);
      expect(matches[0]!.caller).toEqual({ _tag: "agent", agentId: project.leadAgentId });
    }
  });
  let taskId: string;
  const verify = async (client: Client) => {
    const rows = await events(client);
    const asked = rows.find((row) => row.event._tag === "QuestionAsked")!.event;
    if (asked._tag !== "QuestionAsked") throw new Error("question absent");
    taskId = asked.taskId!;
    expect(asked.projectId).toBe(project.projectId);
    const answered = rows.filter((row) => row.event._tag === "QuestionAnswered" && row.event.questionId === asked.questionId);
    expect(answered).toHaveLength(1);
    expect(answered[0]!.requestId).toBe(answer!.requestId);
    const event = answered[0]!.event;
    if (event._tag !== "QuestionAnswered") throw new Error("answer absent");
    expect(event.answeredBy).toEqual({ _tag: "owner" }); expect(event.text).toBe(answerText);
    const changes = rows.filter((row) => row.event._tag === "project.TaskChanged" && row.event.taskId === taskId && row.event.state === "done");
    expect(changes).toHaveLength(1);
    expect(rows.filter((row) => row.event._tag === "DeliveryQueued" && row.event.delivery.id === event.deliveryId
      && row.event.delivery.target === project.leadAgentId && row.event.delivery.source?._tag === "question" && row.event.delivery.source.id === asked.questionId)).toHaveLength(1);
    expect(rows.filter((row) => row.event._tag === "DeliveryAccepted" && row.event.deliveryId === event.deliveryId)).toHaveLength(1);
    const tasks = await run(client["project.read"]({ requestId: id(), projectId: project.projectId, collection: "tasks" }));
    expect("items" in tasks && tasks.items.find((row) => "taskId" in row && row.taskId === taskId)).toMatchObject({ state: "done" });
  };
  await step("project: answer from the board commits one linked result and reaches the actual lead", async () => {
    await page.goto(`${origin}/#/project/${project.projectId}/board`);
    await page.locator(".sprint-card").filter({ hasText: "Provider decision" }).click();
    const question = page.getByRole("region", { name: "Question", exact: true });
    await expect(question).toContainText("May I use the existing contracts?");
    await question.getByRole("textbox", { name: "Answer", exact: true }).fill(answerText);
    await question.getByRole("button", { name: "Send answer", exact: true }).click();
    await expect.poll(() => answer !== undefined).toBe(true);
    await expect.poll(async () => {
      const rows = await events(owner);
      const answered = rows.find((row) => row.event._tag === "QuestionAnswered");
      const deliveryId = answered?.event._tag === "QuestionAnswered" ? answered.event.deliveryId : undefined;
      return deliveryId !== undefined && rows.some((row) => row.event._tag === "DeliveryAccepted" && row.event.deliveryId === deliveryId);
    }, { timeout: 180_000 }).toBe(true);
    await verify(owner);
    await run(owner.answer(answer!)); // Exact page body/key replays its real receipt.
    await verify(owner);
    await page.goto(`${origin}/#/thread/${project.leadAgentId}`);
    await expect(page.getByRole("article", { name: "Agent message", exact: true }).filter({ hasText: "OWNER_DECISION_RECEIVED" })).toBeVisible({ timeout: 180_000 });
  });
  page.off("websocket", wire);
  return { verify: async (client: Client) => {
    await verify(client);
    await page.goto(`${origin}/#/project/${project.projectId}/task/${taskId}`);
    await expect(page.locator(".task-timeline")).toContainText(answerText);
    await expect(page.locator(".detail-status")).toContainText("Done");
    await run(client.answer(answer!));
    await verify(client);
  } };
}
