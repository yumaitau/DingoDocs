export const notificationProviders = [
  "in_app",
  "smtp",
  "teams",
  "slack",
  "discord",
  "webhook",
] as const;

export const aiProviders = ["ollama", "openai", "anthropic"] as const;

export const aiConfirmation =
  "I confirm this data may be sent to the configured AI provider";
