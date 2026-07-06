import type { ModelItem } from "./configTypes";

type FetchedModel = { id: string; name?: string };

/**
 * 根据从 API 拉取的模型列表和用户选中项，生成待新增的 ModelItem 列表。
 * 过滤规则：
 * - 只保留用户在弹层中勾选的模型（selectedModelIds）
 * - 排除 provider 中已存在的模型（existingModels），避免重复添加
 */
export function buildModelsFromFetchedSelection(
	fetchedModels: FetchedModel[],
	selectedModelIds: string[],
	existingModels: ModelItem[],
): ModelItem[] {
	const existingIds = new Set(existingModels.map((model) => model.id));
	const selectedIds = new Set(selectedModelIds);
	return fetchedModels
		.filter((model) => selectedIds.has(model.id) && !existingIds.has(model.id))
		.map((model) => ({
			id: model.id,
			name: model.name ?? model.id,
			contextWindow: 1000000,
			maxTokens: 128000,
			reasoning: true,
		}));
}
