/** Мета хендлера form/chat. Визуалка — chat.js. */
export default {
    icon: 'icons:question-answer',
    label: 'Чат',
    order: 1,
    async showSettings() {
        const { openMessengerSettingsDialog } = await import('/$server/$folder/lib/messenger-settings/messenger-settings.js');
        return openMessengerSettingsDialog(this);
    },
}
