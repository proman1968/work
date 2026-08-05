export default {
    icon: 'carbon:reset',
    async execute() {
        try{
            const $context = await this.$context;
            await $context.fetch('devModeToggle', {}, { value: !WORK.DEV_MODE });
            const check_fn = async () => {
                return new Promise((resolve, reject) => {
                    fetch(window.location.origin, { method: 'HEAD' })
                        .then(() => resolve(true))
                        .catch(() => {
                            setTimeout(() => {
                                resolve(check_fn());
                            }, 300);
                        });
                });
            }
            await new Promise(resolve => {
                setTimeout(() => {
                    resolve(check_fn());
                }, 3000);
            });
            location.reload();
        }
        catch(err){
            console.error(err);
            return false;
        }
    }
}