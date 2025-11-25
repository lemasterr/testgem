export interface TelegramTestResult {
  ok: boolean;
  error?: string;
  details?: string;
}

export const sendTestMessage = async (
  botToken?: string,
  chatId?: string
): Promise<TelegramTestResult> => {
  if (!botToken || !chatId) {
    return { ok: false, error: 'Telegram bot token or chat id missing' };
  }

  // Stubbed implementation – integrate real Telegram bot logic later.
  return { ok: true, details: 'Test message queued (stubbed)' };
};
