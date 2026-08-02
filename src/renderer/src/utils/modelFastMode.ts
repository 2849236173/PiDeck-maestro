/**
 * Models whose upstream API supports the independent Fast service tier.
 * This allowlist controls only whether the toggle is clickable; it does not
 * alter or infer the Pi thinking level.
 */
export function supportsFastMode(modelId: string | undefined): boolean {
	if (!modelId) return false;
	return /(?:^|[-_/:])(?:gpt[-_]?5\.(?:5|6)|grok[-_]?4(?:\.5)?)$/i.test(modelId.trim());
}
