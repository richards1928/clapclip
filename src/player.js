let apiCallbacks = [];
let apiLoaded = false;

/**
 * Dynamically loads the YouTube Iframe Player API and resolves with the YT global object.
 */
export function loadYouTubeAPI() {
  return new Promise((resolve) => {
    if (window.YT && window.YT.Player) {
      resolve(window.YT);
      return;
    }
    
    apiCallbacks.push(resolve);
    
    if (apiLoaded) return;
    apiLoaded = true;

    const tag = document.createElement('script');
    tag.src = 'https://www.youtube.com/iframe_api';
    const firstScriptTag = document.getElementsByTagName('script')[0];
    firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);

    // Global callback required by YouTube script
    window.onYouTubeIframeAPIReady = () => {
      apiCallbacks.forEach((cb) => cb(window.YT));
      apiCallbacks = [];
    };
  });
}

/**
 * Extract YouTube video ID from various URL formats
 * Supports standard, share links, embed URLs, and Shorts
 */
export function extractVideoId(url) {
  if (!url) return null;
  
  // Clean URL trim
  url = url.trim();

  // Pattern checks
  const patterns = [
    // Standard and embed URLs
    /(?:youtube\.com\/(?:[^\/]+\/.+\/|(?:v|e(?:mbed)?)\/|.*[?&]v=)|youtu\.be\/)([^"&?\/\s]{11})/i,
    // Shorts URLs
    /youtube\.com\/shorts\/([^"&?\/\s]{11})/i,
    // Live stream URLs
    /youtube\.com\/live\/([^"&?\/\s]{11})/i
  ];

  for (const pattern of patterns) {
    const match = url.match(pattern);
    if (match && match[1]) {
      return match[1];
    }
  }

  // Fallback if user just entered the 11 character ID directly
  if (url.length === 11 && /^[a-zA-Z0-9_-]{11}$/.test(url)) {
    return url;
  }

  return null;
}

export class ClipPlayer {
  constructor(containerId, options = {}) {
    this.containerId = containerId;
    this.player = null;
    this.currentVideoId = null;
    this.startTime = 0;
    this.endTime = 0;
    this.isLooping = true;
    this.pollInterval = null;
    
    // Callbacks
    this.onReadyCb = options.onReady || (() => {});
    this.onStateChangeCb = options.onStateChange || (() => {});
    this.onTimeUpdateCb = options.onTimeUpdate || (() => {});
    this.onErrorCb = options.onError || (() => {});
  }

  async init(videoId) {
    this.currentVideoId = videoId;
    const YT = await loadYouTubeAPI();
    
    return new Promise((resolve) => {
      // If player already exists, load video instead of re-instantiating
      if (this.player) {
        this.player.loadVideoById({
          videoId: videoId,
          startSeconds: this.startTime
        });
        resolve(this.player);
        return;
      }

      this.player = new YT.Player(this.containerId, {
        height: '100%',
        width: '100%',
        videoId: videoId,
        playerVars: {
          autoplay: 0,
          controls: 1, // Keep native controls for better UX
          rel: 0,
          showinfo: 0,
          iv_load_policy: 3,
          modestbranding: 1
        },
        events: {
          onReady: (event) => {
            this.startPolling();
            this.onReadyCb(event);
            resolve(this.player);
          },
          onStateChange: (event) => {
            this.handleStateChange(event);
          },
          onError: (event) => {
            this.onErrorCb(event);
          }
        }
      });
    });
  }

  handleStateChange(event) {
    const state = event.data;
    
    // YT.PlayerState definitions:
    // UNSTARTED = -1, ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5
    if (state === 1) { // PLAYING
      this.startPolling();
    } else {
      this.stopPolling();
    }
    
    this.onStateChangeCb(state);
  }

  startPolling() {
    this.stopPolling();
    this.pollInterval = setInterval(() => {
      if (!this.player || typeof this.player.getCurrentTime !== 'function') return;
      
      const currentTime = this.player.getCurrentTime();
      this.onTimeUpdateCb(currentTime);

      // Check boundaries
      if (this.endTime > 0 && currentTime >= this.endTime) {
        if (this.isLooping) {
          this.seekTo(this.startTime);
        } else {
          this.pause();
          this.seekTo(this.startTime);
        }
      }
    }, 100);
  }

  stopPolling() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
  }

  setClipRange(start, end) {
    this.startTime = Math.max(0, start);
    this.endTime = end;
    
    // If current player time is outside new boundaries, adjust it
    if (this.player && typeof this.player.getCurrentTime === 'function') {
      const cur = this.player.getCurrentTime();
      if (cur < this.startTime || (this.endTime > 0 && cur > this.endTime)) {
        this.seekTo(this.startTime);
      }
    }
  }

  setLoop(enabled) {
    this.isLooping = enabled;
  }

  play() {
    if (this.player && typeof this.player.playVideo === 'function') {
      this.player.playVideo();
    }
  }

  pause() {
    if (this.player && typeof this.player.pauseVideo === 'function') {
      this.player.pauseVideo();
    }
  }

  seekTo(seconds) {
    if (this.player && typeof this.player.seekTo === 'function') {
      this.player.seekTo(seconds, true);
    }
  }

  getCurrentTime() {
    if (this.player && typeof this.player.getCurrentTime === 'function') {
      return this.player.getCurrentTime();
    }
    return 0;
  }

  getDuration() {
    if (this.player && typeof this.player.getDuration === 'function') {
      return this.player.getDuration();
    }
    return 0;
  }

  getVideoData() {
    if (this.player && typeof this.player.getVideoData === 'function') {
      return this.player.getVideoData();
    }
    return null;
  }

  destroy() {
    this.stopPolling();
    if (this.player && typeof this.player.destroy === 'function') {
      this.player.destroy();
      this.player = null;
    }
  }
}
