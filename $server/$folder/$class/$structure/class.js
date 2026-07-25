export default{
    /**
     * Хук ядра save_secret: реакция на сохранение секрета.
     * Импорты динамические — merged-скрипт класса импортируется и в браузере,
     * статический import 'node:*' его сломал бы.
     */
    async on_secret_save({ name, data }) {
        if (name !== 'email')
            return;
        const { pathToFileURL } = await import('node:url');
        const path = await import('node:path');
        const { ensureMailboxFolders } = await import(pathToFileURL(path.join(process.cwd(), '$server/$folder/lib/email/settings.js')).href);
        await ensureMailboxFolders(this, data?.mailboxes || {});
    },
    get status(){
        return this.supervisors?.then(async supervisors=>{
            let status = '';
            if(supervisors.length)
                status += '<b>' + supervisors[0]?.label+'</b>';
            
            let members = await this.members;
            if(members.length){
                status += '<br>Users: <b>' + members.length+'</b> [' + members.map(u=>u.label).join(', ') + ']';

            }
            return this.status = status
        })
    }
}