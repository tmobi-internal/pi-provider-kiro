import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

let _ctx: ExtensionContext | undefined;

export function setNotifyContext(ctx: ExtensionContext) {
  _ctx = ctx;
}

export function notify(message: string, type?: "info" | "warning" | "error") {
  _ctx?.ui.notify(message, type);
}
