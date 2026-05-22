import type { ExtensionContext } from "@mariozechner/pi-coding-agent";

let _ctx: ExtensionContext | undefined;

export function setNotifyContext(ctx: ExtensionContext | undefined) {
  _ctx = ctx;
}

export function notify(message: string, type?: "info" | "warning" | "error") {
  try {
    _ctx?.ui.notify(message, type);
  } catch {}
}
