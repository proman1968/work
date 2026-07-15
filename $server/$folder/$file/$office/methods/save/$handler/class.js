export default {
    async execute(...args) {
        console.log(this.$item.$context);
        let url = await this.$item.$context.oo_commandServiceUrl;
        url ||= 'https://work.odant.org/onlyoffice/coauthoring/CommandService.ashx';
        let key = await  this.$item.$context.oo_key ;
        key ||= '_root_doc_document_docx_017';
        let response = await fetch(url, {
            method: 'POST',
            body: JSON.stringify({
                c: 'forcesave',
                key,
                userdata: 'save file'
            })
        })
        let res = await response.json()
        console.log(res);
        this.$item.$context.isChanged = false;

    }
}
