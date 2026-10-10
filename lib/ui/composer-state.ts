export function isComposerSendDisabled(value: string, disabled = false): boolean {
  return Boolean(disabled) || value.trim().length === 0;
}
