import fs from 'fs/promises';

export class PromptManager {
  private cache: Map<string, string[]> = new Map();

  constructor(private promptsRoot: string) {}

  // Загружаем всё в память
  async loadPrompts(sessionId: string, filePath: string): Promise<void> {
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const lines = content
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter((l) => l.length > 0 && !l.startsWith('#'));

      this.cache.set(sessionId, lines);
      // console.log(`[PromptManager] Loaded ${lines.length} prompts for session ${sessionId}`);
    } catch (error) {
      console.error(`[PromptManager] Failed to load prompts for ${sessionId}:`, error);
      this.cache.set(sessionId, []);
    }
  }

  // Берем ВСЕГДА первый доступный (режим очереди)
  peekNextPrompt(sessionId: string): string | null {
    const prompts = this.cache.get(sessionId);
    if (!prompts || prompts.length === 0) return null;
    return prompts[0];
  }

  hasMore(sessionId: string): boolean {
    const prompts = this.cache.get(sessionId);
    return !!prompts && prompts.length > 0;
  }

  // Удаляем первый промпт из памяти И из файла
  async consumeCurrentPrompt(sessionId: string, filePath: string): Promise<void> {
    const prompts = this.cache.get(sessionId);
    if (!prompts || prompts.length === 0) return;

    // Удаляем из памяти
    prompts.shift();
    this.cache.set(sessionId, prompts);

    // Перезаписываем файл
    try {
      // Читаем исходный файл, чтобы сохранить комментарии, если они нужны,
      // но для простоты автоматизации часто проще перезаписать чистый список.
      // В данном случае мы сохраним только оставшиеся активные промпты.
      await fs.writeFile(filePath, prompts.join('\n'), 'utf-8');
    } catch (error) {
      console.error(`[PromptManager] Failed to update file for ${sessionId}:`, error);
    }
  }
}