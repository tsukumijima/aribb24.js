import CanvasProvider from './canvas-provider'

interface RendererOption {
  width?: number,
  height?: number,
  data_identifer?: number,
  data_group_id?: number,
  forceStrokeColor?: string,
  forceBackgroundColor?: string,
  normalFont?: string,
  gaijiFont?: string,
  drcsReplacement?: boolean,
}

export default class CanvasID3Renderer {
  private media: HTMLMediaElement | null = null
  private id3Track: TextTrack | null = null
  private b24Track: TextTrack | null = null
  private subtitleElement: HTMLElement | null = null
  private canvas: HTMLCanvasElement | null = null
  private resizeObserver: ResizeObserver | null = null
  private mutationObserver: MutationObserver | null = null
  private isOnSeeking: boolean = false
  private onB24CueChangeDrawed: boolean = false

  private onID3AddtrackHandler: ((event: TrackEvent) => void) | null = null
  private onID3CueChangeHandler: (() => void) | null = null

  private onB24CueChangeHandler: (() => void) | null = null

  private onSeekingHandler: (() => void) | null = null
  private onSeekedHandler: (() => void) | null = null
  private onResizeHandler: (() => void) | null = null

  private rendererOption: RendererOption | undefined
  private data_identifer: number
  private data_group_id: number

  public constructor(option?: RendererOption) {
    this.data_identifer = option?.data_identifer ?? 0x80 // default: caption
    this.data_group_id = option?.data_group_id ?? 0x01 // default: 1st language
    this.rendererOption = {
      ... option,
      data_identifer: this.data_identifer,
      data_group_id: this.data_group_id,
    }
  }

  public attachMedia(media: HTMLMediaElement, subtitleElement?: HTMLElement): void {
    this.detachMedia()
    this.media = media
    this.subtitleElement = subtitleElement ?? media.parentElement
    this.setupTrack()
    this.setupCanvas()
  }

  public detachMedia(): void {
    this.cleanupCanvas()
    this.cleanupTrack()
    this.media = this.subtitleElement = null
  }

  public dispose(): void {
    this.detachMedia()
  }

  public getCanvas(): HTMLCanvasElement | null {
    return this.canvas
  }

  public refresh(): void {
    this.onResize()
  }

  public show(): void {
    if (!this.b24Track) {
      return
    }

    this.b24Track.mode = 'hidden'
    this.onB24CueChange()
  }

  public hide(): void {
    if (!this.b24Track) {
      return
    }

    this.b24Track.mode = 'disabled'
    if (!this.canvas) {
      return
    }

    const ctx = this.canvas.getContext('2d')
    if (!ctx) { return }
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height)
  }

  private onID3CueChange() {
    if (!this.media || !this.id3Track || !this.b24Track) {
      return
    }

    if (this.isOnSeeking) { return }

    const CueClass = window.VTTCue ?? window.TextTrackCue

    const activeCues = this.id3Track.activeCues ?? []
    for (let i = 0; i < activeCues.length; i++) {
      const id3_cue = activeCues[i] as any;
      const start_time = id3_cue.startTime;

      const binary = window.atob(id3_cue.value.data || id3_cue.value.info);
      const pes = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) { pes[i] = binary.charCodeAt(i); }

      const provider: CanvasProvider = new CanvasProvider(pes, start_time);
      const estimate = provider.render(this.rendererOption) // detect target b24 data and calc endTime
      if (estimate == null) { continue; }

      const end_time = estimate.endTime;

      if (start_time <= this.media.currentTime && this.media.currentTime <= end_time) {
        // なんか Win Firefox で Cue が endTime 過ぎても activeCues から消えない場合があった、バグ?
        const b24_cue = new CueClass(start_time, end_time, '');
        (b24_cue as any).data = pes;

        this.b24Track.addCue(b24_cue);
      }
    }
  }

  private onB24CueChange() {
    if (!this.media || !this.b24Track || !this.canvas) {
      this.onB24CueChangeDrawed = false
      return
    }

    const canvasContext = this.canvas.getContext('2d')
    if (!canvasContext) {
      this.onB24CueChangeDrawed = false
      return
    }
    canvasContext.clearRect(0, 0, this.canvas.width, this.canvas.height);

    const activeCues = this.b24Track.activeCues
    if (activeCues && activeCues.length > 0) {
      const lastCue = activeCues[activeCues.length - 1] as any

      if ((lastCue.startTime <= this.media.currentTime && this.media.currentTime <= lastCue.endTime) && !this.isOnSeeking) {
        // なんか Win Firefox で Cue が endTime 過ぎても activeCues から消えない場合があった、バグ?

        const provider: CanvasProvider = new CanvasProvider(lastCue.data, lastCue.startTime);
        provider.render({
          ... this.rendererOption,
          canvas: this.canvas ?? undefined,
          width: this.rendererOption?.width ?? this.canvas.width,
          height: this.rendererOption?.height ?? this.canvas.height,
        })

        this.onB24CueChangeDrawed = true
      } else {
        this.onB24CueChangeDrawed = false
      }

      for (let i = 0; i < activeCues.length - 1; i++) {
        const cue = activeCues[i]
        cue.endTime = Math.min(cue.endTime, lastCue.startTime)
      }
    } else{
      this.onB24CueChangeDrawed = false
    }
  }

  private onSeeking() {
    this.isOnSeeking = true
    this.onB24CueChange()
  }

  private onSeeked() {
    this.isOnSeeking = false
  }

  private onResize() {
    if (!this.canvas || !this.media) {
      return
    }

    const style = window.getComputedStyle(this.media)
    const purpose_width = Math.max((this.media as any).videoWidth, Number.parseInt(style.width) * window.devicePixelRatio)
    const purpose_height = Math.max((this.media as any).videoHeight, Number.parseInt(style.height) * window.devicePixelRatio)

    this.canvas.width = purpose_width
    this.canvas.height = purpose_height

    if (!this.b24Track) {
      return;
    }

    const canvasContext = this.canvas.getContext('2d')
    if (!canvasContext) { return }
    canvasContext.clearRect(0, 0, this.canvas.width, this.canvas.height);

    if (!this.onB24CueChangeDrawed) { return }

    // onB24CueChange とほぼ同じだが、this.onB24CueChangeDrawed を変更しない
    const activeCues = this.b24Track.activeCues
    if (activeCues && activeCues.length > 0) {
      const lastCue = activeCues[activeCues.length - 1] as any

      if ((lastCue.startTime <= this.media.currentTime && this.media.currentTime <= lastCue.endTime) && !this.isOnSeeking) {
        // なんか Win Firefox で Cue が endTime 過ぎても activeCues から消えない場合があった、バグ?

        const provider: CanvasProvider = new CanvasProvider(lastCue.data, lastCue.startTime);
        provider.render({
          ... this.rendererOption,
          canvas: this.canvas ?? undefined,
          width: this.rendererOption?.width ?? this.canvas.width,
          height: this.rendererOption?.height ?? this.canvas.height,
        })
      }
    }
  }

  private onID3Addtrack(event: TrackEvent): void {
    if (!this.media) {
      return;
    }

    const textTrack = event.track!;
    if (textTrack.kind !== 'metadata') { return; }

    if (textTrack.inBandMetadataTrackDispatchType === 'com.apple.streaming' || textTrack.label === 'id3') {
      if (this.id3Track && this.onID3CueChangeHandler) {
        this.id3Track.removeEventListener('cuechange', this.onID3CueChangeHandler)
        this.onID3CueChangeHandler = null
      }
      this.id3Track = textTrack

      this.id3Track.mode = 'hidden'
      this.onID3CueChangeHandler = this.onID3CueChange.bind(this)
      this.id3Track.addEventListener('cuechange', this.onID3CueChangeHandler)
    }
  }

  private setupTrack(): void {
    if (!this.media) {
      return
    }

    const aribb24js_label = `ARIB B24 Japanese (data_identifer=0x${this.data_identifer.toString(16)}, data_group_id=${this.data_group_id})`
    for (let i = 0; i < this.media.textTracks.length; i++) {
      const track = this.media.textTracks[i]
      if (track.label === aribb24js_label) {
        this.b24Track = track
        break
      }
    }
    if (!this.b24Track) {
      this.b24Track = this.media.addTextTrack('metadata', aribb24js_label, 'ja')
      this.b24Track.mode = 'hidden'
    }

    this.onB24CueChangeHandler = this.onB24CueChange.bind(this)
    this.b24Track.addEventListener('cuechange', this.onB24CueChangeHandler)

    for (let i = 0; i < this.media.textTracks.length; i++) {
      const track = this.media.textTracks[i];

      if (track.kind !== 'metadata') { continue; }
      if (track.inBandMetadataTrackDispatchType === 'com.apple.streaming' || track.label === 'id3') {
        this.id3Track = track;
        break;
      }
    }

    if (this.id3Track) {
      this.id3Track.mode = 'hidden'
      this.onID3CueChangeHandler = this.onID3CueChange.bind(this)
      this.id3Track.addEventListener('cuechange', this.onID3CueChangeHandler)
    }

    this.onID3AddtrackHandler = this.onID3Addtrack.bind(this)
    this.media.textTracks.addEventListener('addtrack', this.onID3AddtrackHandler)

    this.onSeekingHandler = this.onSeeking.bind(this)
    this.onSeekedHandler = this.onSeeked.bind(this)
    this.media.addEventListener('seeking', this.onSeekingHandler)
    this.media.addEventListener('seeked', this.onSeekedHandler)
  }

  private setupCanvas(): void {
    if (!this.media || !this.subtitleElement){
      return
    }
    this.canvas = document.createElement('canvas')
    this.canvas.style.position = 'absolute'
    this.canvas.style.top = this.canvas.style.left = '0'
    this.canvas.style.pointerEvents = 'none'
    this.canvas.style.width = '100%'
    this.canvas.style.height = '100%'

    this.onResize()

    this.subtitleElement.appendChild(this.canvas)

    this.onResizeHandler = this.onResize.bind(this)
    this.media.addEventListener('loadeddata', this.onResizeHandler)

    if (window.ResizeObserver) {
      this.resizeObserver = new ResizeObserver(() => {
        this.onResize()
      })
      this.resizeObserver.observe(this.media)
    } else {
      window.addEventListener('resize', this.onResizeHandler)

      if (window.MutationObserver) {
        this.mutationObserver = new MutationObserver(() => {
          this.onResize()
        })
        this.mutationObserver.observe(this.media, {
          attributes: true,
          attributeFilter: ['class', 'style']
        })
      }
    }
  }

  private cleanupTrack(): void {
    if (this.b24Track && this.onB24CueChangeHandler) {
      this.b24Track.removeEventListener('cuechange', this.onB24CueChangeHandler)
      this.onB24CueChangeHandler = null
    }
    if (this.id3Track && this.onID3CueChangeHandler) {
      this.id3Track.removeEventListener('cuechange', this.onID3CueChangeHandler)
      this.onID3CueChangeHandler = null
    }

    if (this.media){
      if (this.onSeekingHandler) {
        this.media.removeEventListener('seeking', this.onSeekingHandler)
        this.onSeekingHandler = null
      }
      if (this.onSeekedHandler) {
        this.media.removeEventListener('seeked', this.onSeekedHandler)
        this.onSeekedHandler = null
      }
      if (this.onID3AddtrackHandler) {
        this.media.textTracks.removeEventListener('addtrack', this.onID3AddtrackHandler)
        this.onID3AddtrackHandler = null
      }
    }

    this.b24Track = this.id3Track = null
  }

  private cleanupCanvas(): void {
    if (this.onResizeHandler) {
      window.removeEventListener('resize', this.onResizeHandler)
      if (this.media) {
         this.media.removeEventListener('loadeddata', this.onResizeHandler)
      }

      this.onResizeHandler = null
    }

    if (this.resizeObserver) {
      this.resizeObserver.disconnect()
      this.resizeObserver = null
    }

    if (this.mutationObserver) {
      this.mutationObserver.disconnect()
      this.mutationObserver = null
    }

    if (this.canvas && this.subtitleElement) {
      this.subtitleElement.removeChild(this.canvas)
    }
    this.canvas = null
  }
}
