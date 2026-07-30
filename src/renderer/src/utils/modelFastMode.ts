/**
 * GPT 5.5/5.6 provider IDs expose a Fast reasoning-effort mode. Pi itself only
 * accepts canonical thinking levels, so Fast is represented by the `minimal`
 * level and translated through the model's thinkingLevelMap.
 */
export function supportsFastMode(modelId: string | undefined): boolean {
	if (!modelId) return false;
	return /(?:^|[-_/:])gpt[-_]?5\.(?:5|6)(?:$|[-_/:.])/i.test(modelId.trim());
}
