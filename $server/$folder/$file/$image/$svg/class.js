export default {
    async svg_icons_list() {
        try{
            const data = String(await this.load());
            return [...data.matchAll(/<(?:symbol|g)\b[^>]*\bid=["']([^"']+)["']/gi)].map(m => m[1]);
        }
        catch(e){
            return [];
        }
    }
}
