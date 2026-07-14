export default{
    template: /*html*/ `
        <audio-player></audio-player>
    `,
}
ODA({ is: 'audio-player', template: /* html */`
        <style>
            :host {
                @apply --horizontal;
                @apply --dark;
                padding-right: 5px;
                justify-content: center;
                position: relative;

            }
            audio {
                display: none;
            }
            span{
                font-size: small;
            }
        </style>
        <audio :src @loadeddata="onLoadedData" @timeupdate="updateTheProgressBar" controls></audio>
        <div vertical center>
            <oda-icon :icon-size="iconSize * 1.5" " :icon="tapIcon" @tap="onTap"></oda-icon>
            <span>{{timeText}}</span>
        </div>
    `,
    get src(){
        return this.$pdp.$item?.url
    },
    get audioEl() {
        return this.$?.('audio');
    },

    iconSize: 34,
    rainbow:{
        $def: false,
        $attr: true,
    },
    isPlayed: {
        $def: false,
        set(n){
            this.rainbow = n
        }
    },
    isPaused: false,
    duration: '',
    currentTimeFormated: '00:00',
    // progressBarWidth: 0,
    get songName() {
        return this.$pdp.$item?.label.replace(/\.[^/.]+$/, "");
    },
    get tapIcon() {
        return this.isPlayed ? 'av:pause-circle-outline' : 'av:play-circle-outline';
    },
    get timeText() {
        return this.isPlayed || this.isPaused ? `${this.currentTimeFormated} / ${this.duration}` : this.duration;
    },
    onTap(e) {
        if(!this.isPlayed) {
            this.audioEl.play();
            this.isPlayed = true;
        } else {
            this.audioEl.pause();
            this.isPlayed = false;
            this.isPaused = true;
        }
    },
    onLoadedData(e) {
        this.duration = this.getMinSecFromTime(e.target.duration);
    },
    updateTheProgressBar(e) {
        const duration = e.target.duration;
        const currentTime = e.target.currentTime;
        // this.progressBarWidth = (currentTime / duration) * 100;
        if(currentTime === duration) {
            this.isPlayed = false;
        }
        this.currentTimeFormated = this.getMinSecFromTime(currentTime);
    },
    getMinSecFromTime(time) {
        let min = parseInt(time / 60);
        if (min < 10) min = "0" + min;
        let sec = parseInt(time % 60);
        if (sec < 10) sec = "0" + sec;
        return `${min}:${sec}`;
    }
})