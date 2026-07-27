export default{

    /**

     * Создать папки ящиков после сохранения секрета email.

     * Вызывается из UI (form/email), не из ядра save_secret.

     */

    async ensure_mailbox_folders(params = {}) {

        let data = params.post;

        if (typeof data === 'string')

            data = JSON.parse(data);

        const mailboxes = data?.mailboxes || data || {};

        const { pathToFileURL } = await import('node:url');

        const path = await import('node:path');

        const { ensureMailboxFolders } = await import(pathToFileURL(path.join(process.cwd(), '$server/$folder/lib/email/settings.js')).href);

        await ensureMailboxFolders(this, mailboxes);

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

