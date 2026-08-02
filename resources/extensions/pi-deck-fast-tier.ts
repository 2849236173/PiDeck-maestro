import { readFile } from "node:fs/promises";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";

/**
 * PiDeck Fast tier bridge.
 *
 * Research note (Pi installed 0.81.x): Pi exposes before_provider_request,
 * which runs after the provider payload is built and allows an extension to
 * replace that payload. No native service_tier setting exists in the inspected
 * settings/model schemas, so the Deck uses a session-side marker instead of
 * coupling Fast to thinkingLevel or thinkingLevelMap.
 */
const MARKER_SUFFIX = ".fast-mode";

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export default function registerFastTier(pi: ExtensionAPI) {
  pi.on("before_provider_request", async (event, ctx) => {
    const sessionFile = ctx.sessionManager.getSessionFile();
    if (!sessionFile) return;

    try {
      const marker = await readFile(`${sessionFile}${MARKER_SUFFIX}`, "utf8");
      if (marker.trim() !== "fast") return;
      if (!isRecord(event.payload)) return;
      return { ...event.payload, service_tier: "fast" };
    } catch {
      // Missing marker means Fast is OFF; preserve the original provider payload.
      return;
    }
  });
}
