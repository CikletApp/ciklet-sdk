// ─────────────────────────────────────────────────────────────────
// @ciklet/embedded-activities-sdk — RPC Transport
// Low-level postMessage RPC layer between iframe ↔ host
// ─────────────────────────────────────────────────────────────────

import type { RPCMessage } from "../types.js";

let _counter = 0;

/** Generate a unique nonce for RPC request/response correlation */
export function generateNonce(): string {
  _counter += 1;
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  // `randomUUID` needs a secure context; `getRandomValues` does not.
  if (typeof crypto !== "undefined" && typeof crypto.getRandomValues === "function") {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let hex = "";
    for (const b of bytes) hex += b.toString(16).padStart(2, "0");
    return `${_counter}-${hex}`;
  }
  return `${Date.now()}-${_counter}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Encode an RPC message to be sent via postMessage */
export function encodeMessage(cmd: string, args?: unknown, nonce?: string, evt?: string): RPCMessage {
  return {
    cmd,
    nonce: nonce ?? null,
    evt: evt ?? null,
    args: args ?? undefined,
    data: undefined,
  };
}

/** Validate that a raw message event is a valid RPC message from the expected source */
export function isValidRPCMessage(data: unknown): data is RPCMessage {
  if (typeof data !== "object" || data === null) return false;
  const msg = data as Record<string, unknown>;
  return (
    typeof msg.cmd === "string" &&
    (msg.nonce === null || msg.nonce === undefined || typeof msg.nonce === "string") &&
    (msg.evt === null || msg.evt === undefined || typeof msg.evt === "string")
  );
}
