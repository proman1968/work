export default {
    icon: 'iconoir:media-video',
    template: /*html*/ `
        <style>
            :host {
                background-color: black;
            }
        </style>
        <video :src width="300" height="200" muted controls  style="align-self: center;"></video>
    `,
    get src(){
        return this.$item?.url
    }
}