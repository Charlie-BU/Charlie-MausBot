import type { Json } from "./agents-client.ts";
import type { ToolCallContext, ToolCallResult } from "./agents-call.ts";

export const MESSAGE_PIN_TOOL = {
  name: "set_message_pin",
  description: "Pin or unpin one message in your conversation using its message ID (from session_search). Supply thread_id for another conversation. Only the Chief can change another bot's conversation.",
  inputSchema: { type: "object", additionalProperties: false, required: ["message_id", "pinned"],
    properties: { message_id: { type: "string" }, pinned: { type: "boolean" }, thread_id: { type: "string" } } },
};

export async function callMessagePin(args: Json, context: ToolCallContext): Promise<ToolCallResult> {
  const result = await context.client.api("/api/internal/message-pin", { method: "POST", body: JSON.stringify({
    fromBotId: context.botId, fromThreadId: context.threadId, targetThreadId: args.thread_id ?? context.threadId,
    messageId: args.message_id, pinned: args.pinned,
  }) });
  return result.error ? { text: String(result.error), isError: true } : { text: JSON.stringify(result) };
}
