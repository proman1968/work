export default {
    keywords: `Генерация текста
`,
    async execute(params = {}){
        const input = {
            is_sync: true,
            prompt: params.prompt,
            aspect_ratio: '16:9'

        };
        let result = await WORK.genApi.createNetworkTask('ltx-2', input);
        result = await waitForCompletion(result.request_id);
        for(let response of result.full_response){
            let url = response.url;
            const video = await downloadImage(url);
            let ext = $server.mime.extension(video.contentType);
            params.id = 'video.' + ext;
            params.post = video.buffer;
            await params.work_folder.save_file(params);
        }
        console.log(result)
    }
}