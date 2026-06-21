export default {
    async execute() {       
        try {
            const value = prompt('NPM package name:');
            if (value) {
                const result = await WORK.fetch('/', 'npm', { module: value.toLowerCase().trim() });
                ODA.showMessage(result);
            }
        }
        catch (e) {
            ODA.showError(e);
        }
    }
}