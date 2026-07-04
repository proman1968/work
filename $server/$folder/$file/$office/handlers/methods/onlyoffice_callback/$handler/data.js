export default {
    async execute(...args) {
        const event = args.find(arg => arg?.status) || args.find(arg => arg?.url);
        if ([2, 6].includes(event?.status) && event.url) {
            const response = await fetch(event.url);
            if (!response.ok)
                return JSON.stringify({ error: 1 });
            const blob = await response.blob();

            const file = new File([blob], this.$item.$context.name, {
                type: blob.type || 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
            })
            await this.$item.$context.save_file(file);

            // await this.$item.$context.save(blob, {});
        }
        return JSON.stringify({ error: 0 });
    }
}
