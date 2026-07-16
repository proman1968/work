export default {
    async execute(params = {}) {
        const event = params.post;
        if ([2, 6].includes(event?.status) && event.url) {
            const response = await fetch(event.url);
            if (!response.ok) {
                return JSON.stringify({ error: 1 });
            }
            const arrayBuffer = await response.arrayBuffer();
            const buffer = Buffer.from(arrayBuffer);

            await params.$context.save({ post: buffer });
        }
        return JSON.stringify({ error: 0 });
    }
}
