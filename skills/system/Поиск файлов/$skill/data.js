export default{
    keywords: `
поиск файлов
поиск документов
найти файл
поиск по имени файла
поиск по расширению
поиск по дате изменения
поиск по содержимому
поиск по пути
глобальный поиск файлов
поисковые фильтры
поисковый запрос
каталог файлов
просмотр директорий
командная строка поиска
поиск через консоль
find command
locate tool
dir search
search folders
recursive file search
advanced file finder`,
    async execute(params = {}){
        let rating = await this.search(params);
        if(!rating.length)
            throw new Error('Ничего не найдено!');
        let post = `найдено: (${rating.length})`;
        let includes = rating.map(f=>f.path.slice(1));
        this.save_file({id: 'message.txt', post, includes, receivers: params.user.uid, user: {uid:params.LLM.id,  $user: params.LLM }});
    }
}