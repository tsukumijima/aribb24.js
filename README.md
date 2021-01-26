# aribb24.js

An HTML5 subtitle renderer.  
It is alternative implementation for [b24.js](https://github.com/xqq/b24.js).  

## Feature

* HTML5 Canvas based dot by dot subtitle rendering
* Fully compatible of [b24.js](https://github.com/xqq/b24.js) API
* Colored rendering with font color and background color specified by data packet

## Build

### Preparing

```bash
git clone https://github.com/monyone/aribb24.js
cd aribb24.js
yarn
```

### Compiling aribb24.js library

```bash
yarn run build
```

## Getting Started 

```html
<script src="hls.min.js"></script>
<script src="aribb24.js"></script>
<video id="videoElement"></video>
<script>
    var video = document.getElementById('videoElement');
    var hls = new Hls();
    hls.loadSource('something.m3u8')
    hls.attachMedia(video);
    video.play();

    var b24Renderer = new aribb24js.CanvasRenderer();
    b24Renderer.init().then(function() {
        b24Renderer.attachMedia(video);
        // b24Renderer.attachMedia(video, subtitleElement) also accepted
    });
    hls.on(Hls.Events.FRAG_PARSING_PRIVATE_DATA, function (event, data) {
        for (var sample of data.samples) {
            b24Renderer.pushData(sample.pid, sample.data, sample.pts);
        }
    }
</script>
```
