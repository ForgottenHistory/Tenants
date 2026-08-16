import { llmSettingsFileService, type LlmSettingsData } from './llmSettingsFileService';

class LlmSettingsService {
	/**
	 * Get LLM settings for chat
	 */
	getSettings(): LlmSettingsData {
		return llmSettingsFileService.getSettings('chat');
	}

	/**
	 * Update LLM settings for chat
	 */
	updateSettings(settings: Partial<LlmSettingsData>): LlmSettingsData {
		return llmSettingsFileService.updateSettings('chat', settings);
	}

	/**
	 * Get default settings
	 */
	getDefaultSettings(): LlmSettingsData {
		return llmSettingsFileService.getDefaultSettings('chat');
	}

	/** Pick the model for one request — see `llmSettingsFileService.resolveModel`. */
	resolveModel(settings: { model: string; models?: string[] }): string {
		return llmSettingsFileService.resolveModel(settings);
	}
}

export const llmSettingsService = new LlmSettingsService();
