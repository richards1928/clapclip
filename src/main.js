import { ClipPlayer, extractVideoId } from './player.js';
import { saveClip, getClips, deleteClip, searchClips } from './storage.js';

// DOM Elements
const urlInput = document.getElementById('youtube-url-input');
const loadVideoBtn = document.getElementById('load-video-btn');
const urlErrorMsg = document.getElementById('url-error-msg');
const playerLoader = document.getElementById('player-loader');
const playerPlaceholder = document.getElementById('player-placeholder');
const videoInfoBar = document.getElementById('video-info-bar');
const currentVideoTitle = document.getElementById('current-video-title');
const playerStateBadge = document.getElementById('player-state-badge');

const clipperCard = document.getElementById('clipper-card');
const saveFormCard = document.getElementById('save-form-card');
const clipDurationDisplay = document.getElementById('clip-duration-display');

// Slider & Timeline Elements
const timelineHighlightBar = document.getElementById('timeline-highlight-bar');
const timelinePlayheadIndicator = document.getElementById('timeline-playhead-indicator');
const startRangeInput = document.getElementById('start-range-input');
const endRangeInput = document.getElementById('end-range-input');
const startTimeLabel = document.getElementById('video-start-time-label');
const currentTimeLabel = document.getElementById('video-current-time-label');
const endTimeLabel = document.getElementById('video-end-time-label');

// Precision inputs
const startTimeSeconds = document.getElementById('start-time-seconds');
const endTimeSeconds = document.getElementById('end-time-seconds');
const captureStartBtn = document.getElementById('capture-start-btn');
const captureEndBtn = document.getElementById('capture-end-btn');

// Playback elements
const previewClipBtn = document.getElementById('preview-clip-btn');
const downloadClipBtn = document.getElementById('download-clip-btn');
const loopClipToggle = document.getElementById('loop-clip-toggle');

// Save Form Elements
const saveClipForm = document.getElementById('save-clip-form');
const saveClipBtn = document.getElementById('save-clip-btn');
const clipTitleInput = document.getElementById('clip-title-input');
const clipNotesInput = document.getElementById('clip-notes-input');
const clipTagsInput = document.getElementById('clip-tags-input');

// YouTube Integration Elements
const uploadChannelSelect = document.getElementById('upload-channel-select');
const uploadPlaylistSelect = document.getElementById('upload-playlist-select');
const playlistGroup = document.getElementById('playlist-group');
const authModal = document.getElementById('auth-modal');
const closeAuthModalBtn = document.getElementById('close-auth-modal-btn');
const oauthClientId = document.getElementById('oauth-client-id');
const oauthClientSecret = document.getElementById('oauth-client-secret');
const triggerOauthBtn = document.getElementById('trigger-oauth-btn');

// Library Elements
const savedClipsContainer = document.getElementById('saved-clips-container');
const librarySearchInput = document.getElementById('library-search-input');
const clearAllLibraryBtn = document.getElementById('clear-all-library-btn');
const libraryEmptyState = document.getElementById('library-empty-state');

// Share Modal Elements
const shareModal = document.getElementById('share-modal');
const closeModalBtn = document.getElementById('close-modal-btn');
const shareAppLinkInput = document.getElementById('share-app-link-input');
const shareYtLinkInput = document.getElementById('share-yt-link-input');
const copyButtons = document.querySelectorAll('.btn-copy');

// Global Application State
let activePlayer = null;
let currentVideoDuration = 0;
let isSettingUpVideo = false;
let currentVideoDetails = null;
let editingClipId = null; // To support editing saved clips

// Initialize Application
document.addEventListener('DOMContentLoaded', () => {
  setupEventListeners();
  renderLibrary();
  processURLParameters();
  initYouTubeIntegration();
});

// Setup Listeners
function setupEventListeners() {
  loadVideoBtn.addEventListener('click', handleLoadVideo);
  urlInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') handleLoadVideo();
  });

  // Range Slider Sync
  startRangeInput.addEventListener('input', handleStartSliderInput);
  endRangeInput.addEventListener('input', handleEndSliderInput);

  // Precision number inputs
  startTimeSeconds.addEventListener('change', handleStartTimeNumberChange);
  endTimeSeconds.addEventListener('change', handleEndTimeNumberChange);

  // Capture Button Listeners
  captureStartBtn.addEventListener('click', captureStartTime);
  captureEndBtn.addEventListener('click', captureEndTime);

  // Nudge Buttons (delegated)
  document.querySelectorAll('.btn-nudge').forEach(btn => {
    btn.addEventListener('click', handleNudgeTime);
  });

  // Playback Control Listeners
  previewClipBtn.addEventListener('click', togglePreviewPlayback);
  downloadClipBtn.addEventListener('click', () => {
    if (!activePlayer) return;
    const videoId = activePlayer.currentVideoId;
    const start = parseFloat(startRangeInput.value);
    const end = parseFloat(endRangeInput.value);
    const title = clipTitleInput.value.trim() || 'clip';
    downloadClip(videoId, start, end, title, downloadClipBtn);
  });
  loopClipToggle.addEventListener('change', handleLoopToggleChange);

  // Save Form Listener
  saveClipForm.addEventListener('submit', handleSaveFormSubmit);

  // YouTube Event Listeners
  uploadChannelSelect.addEventListener('change', handleChannelSelectChange);
  closeAuthModalBtn.addEventListener('click', () => authModal.classList.add('hidden'));
  authModal.addEventListener('click', (e) => {
    if (e.target === authModal) authModal.classList.add('hidden');
  });
  triggerOauthBtn.addEventListener('click', handleTriggerOAuth);
  window.addEventListener('message', handleOAuthMessage);

  // Tab Navigation Listeners
  document.querySelectorAll('.tab-btn').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const targetTab = e.currentTarget.dataset.tab;
      switchTab(targetTab);
    });
  });

  const addChannelBtn = document.getElementById('add-channel-btn');
  if (addChannelBtn) {
    addChannelBtn.addEventListener('click', () => {
      authModal.classList.remove('hidden');
    });
  }

  const refreshLogsBtn = document.getElementById('refresh-logs-btn');
  if (refreshLogsBtn) {
    refreshLogsBtn.addEventListener('click', loadUploadLogs);
  }

  // Library Listeners
  librarySearchInput.addEventListener('input', () => {
    renderLibrary(librarySearchInput.value);
  });
  
  clearAllLibraryBtn.addEventListener('click', handleClearAllLibrary);

  // Share Modal Listeners
  closeModalBtn.addEventListener('click', hideShareModal);
  shareModal.addEventListener('click', (e) => {
    if (e.target === shareModal) hideShareModal();
  });

  copyButtons.forEach(btn => {
    btn.addEventListener('click', handleCopyLink);
  });
}

// Check url query params e.g. ?v=xxxx&start=10&end=20
function processURLParameters() {
  const params = new URLSearchParams(window.location.search);
  const videoId = params.get('v') || params.get('video');
  const startParam = parseFloat(params.get('start') || params.get('s'));
  const endParam = parseFloat(params.get('end') || params.get('e'));
  const titleParam = params.get('title');

  if (videoId) {
    urlInput.value = `https://www.youtube.com/watch?v=${videoId}`;
    
    // Trigger video load and auto-fill ranges once loaded
    loadVideo(videoId, () => {
      if (!isNaN(startParam)) {
        updateStartTime(startParam);
      }
      if (!isNaN(endParam)) {
        updateEndTime(endParam);
      }
      
      // Auto-fill title if query parameter exists
      if (titleParam) {
        clipTitleInput.value = decodeURIComponent(titleParam);
      }
      
      // Start playing right away if start time is specified
      if (!isNaN(startParam) && activePlayer) {
        activePlayer.seekTo(startParam);
        activePlayer.play();
      }
    });
  }
}

// Handle Loading Video from Input
function handleLoadVideo() {
  const urlValue = urlInput.value;
  const videoId = extractVideoId(urlValue);

  if (!videoId) {
    urlErrorMsg.classList.remove('hidden');
    urlInput.classList.add('error-border');
    return;
  }

  urlErrorMsg.classList.add('hidden');
  urlInput.classList.remove('error-border');
  loadVideo(videoId);
}

// Load Video & Initialize Player
function loadVideo(videoId, callback = null) {
  isSettingUpVideo = true;
  playerPlaceholder.classList.add('hidden');
  playerLoader.classList.remove('hidden');
  videoInfoBar.classList.add('hidden');

  // Disable controls until loaded
  clipperCard.classList.add('disabled');
  saveFormCard.classList.add('disabled');
  editingClipId = null; // Clear edit session

  if (activePlayer) {
    activePlayer.destroy();
    // Create new iframe container since destroy removes it
    const iframeWrapper = document.querySelector('.player-aspect-ratio');
    const newTarget = document.createElement('div');
    newTarget.id = 'yt-player-container';
    iframeWrapper.appendChild(newTarget);
  }

  activePlayer = new ClipPlayer('yt-player-container', {
    onReady: (event) => {
      playerLoader.classList.add('hidden');
      videoInfoBar.classList.remove('hidden');
      
      // Fetch duration and info
      currentVideoDuration = activePlayer.getDuration();
      currentVideoDetails = activePlayer.getVideoData();
      
      // Update UI title
      if (currentVideoDetails && currentVideoDetails.title) {
        currentVideoTitle.textContent = currentVideoDetails.title;
        clipTitleInput.value = `Clip from ${currentVideoDetails.title}`;
      } else {
        currentVideoTitle.textContent = 'Loaded YouTube Video';
        clipTitleInput.value = 'My Custom Clip';
      }

      // Initialize Slider Bounds
      initSliderControls(currentVideoDuration);
      
      // Enable Clipper & Forms
      clipperCard.classList.remove('disabled');
      saveFormCard.classList.remove('disabled');
      
      isSettingUpVideo = false;

      if (callback) callback();
    },
    onStateChange: (state) => {
      updatePlayerStateBadge(state);
    },
    onTimeUpdate: (currentTime) => {
      updatePlayheadUI(currentTime);
    },
    onError: (err) => {
      console.error('Player error occurred:', err);
      playerLoader.classList.add('hidden');
      playerPlaceholder.classList.remove('hidden');
      alert('Failed to load video. Make sure playback inside embeds is allowed for this video.');
    }
  });

  activePlayer.init(videoId);
}

// Initial Setup of Sliders
function initSliderControls(duration) {
  startRangeInput.max = duration;
  startRangeInput.value = 0;
  
  endRangeInput.max = duration;
  endRangeInput.value = duration;

  startTimeSeconds.max = duration;
  startTimeSeconds.value = 0;
  
  endTimeSeconds.max = duration;
  endTimeSeconds.value = duration.toFixed(1);

  updateTimeLabel(startTimeLabel, 0);
  updateTimeLabel(endTimeLabel, duration);
  updateTimeLabel(currentTimeLabel, 0);

  // Sync Clipper internal settings
  activePlayer.setClipRange(0, duration);
  activePlayer.setLoop(loopClipToggle.checked);

  updateTimelineHighlight();
}

// Slider Input Event Handlers
function handleStartSliderInput() {
  let start = parseFloat(startRangeInput.value);
  let end = parseFloat(endRangeInput.value);

  if (start > end) {
    start = end;
    startRangeInput.value = start;
  }

  updateStartTime(start);
}

function handleEndSliderInput() {
  let start = parseFloat(startRangeInput.value);
  let end = parseFloat(endRangeInput.value);

  if (end < start) {
    end = start;
    endRangeInput.value = end;
  }

  updateEndTime(end);
}

// Numerical Inputs Change Handlers
function handleStartTimeNumberChange() {
  let start = parseFloat(startTimeSeconds.value);
  let end = parseFloat(endTimeSeconds.value);

  if (isNaN(start) || start < 0) start = 0;
  if (start > currentVideoDuration) start = currentVideoDuration;
  if (start > end) start = end;

  startTimeSeconds.value = start.toFixed(1);
  startRangeInput.value = start;
  updateStartTime(start);
}

function handleEndTimeNumberChange() {
  let start = parseFloat(startTimeSeconds.value);
  let end = parseFloat(endTimeSeconds.value);

  if (isNaN(end)) end = currentVideoDuration;
  if (end > currentVideoDuration) end = currentVideoDuration;
  if (end < start) end = start;

  endTimeSeconds.value = end.toFixed(1);
  endRangeInput.value = end;
  updateEndTime(end);
}

// Update Functions to Sync State & Player
function updateStartTime(start) {
  startTimeSeconds.value = start.toFixed(1);
  startRangeInput.value = start;
  updateTimeLabel(startTimeLabel, start);
  
  if (activePlayer) {
    activePlayer.setClipRange(start, parseFloat(endRangeInput.value));
  }
  
  updateTimelineHighlight();
  updateClipDurationDisplay();
}

function updateEndTime(end) {
  endTimeSeconds.value = end.toFixed(1);
  endRangeInput.value = end;
  updateTimeLabel(endTimeLabel, end);
  
  if (activePlayer) {
    activePlayer.setClipRange(parseFloat(startRangeInput.value), end);
  }
  
  updateTimelineHighlight();
  updateClipDurationDisplay();
}

// Update Visual Range Highlight on Track
function updateTimelineHighlight() {
  const start = parseFloat(startRangeInput.value);
  const end = parseFloat(endRangeInput.value);
  
  if (currentVideoDuration === 0) return;

  const leftPercent = (start / currentVideoDuration) * 100;
  const widthPercent = ((end - start) / currentVideoDuration) * 100;

  timelineHighlightBar.style.left = `${leftPercent}%`;
  timelineHighlightBar.style.width = `${widthPercent}%`;
}

// Update playhead location on the visual timeline
function updatePlayheadUI(currentTime) {
  updateTimeLabel(currentTimeLabel, currentTime);
  
  if (currentVideoDuration === 0) return;

  const percent = (currentTime / currentVideoDuration) * 100;
  timelinePlayheadIndicator.style.left = `${percent}%`;
}

// Helper: Format seconds to MM:SS or HH:MM:SS
function formatTime(seconds) {
  if (isNaN(seconds) || seconds === null) return '00:00';
  
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.floor((seconds % 1) * 10);

  const formattedM = m.toString().padStart(2, '0');
  const formattedS = s.toString().padStart(2, '0');

  if (h > 0) {
    const formattedH = h.toString().padStart(2, '0');
    return `${formattedH}:${formattedM}:${formattedS}.${ms}`;
  }
  
  return `${formattedM}:${formattedS}.${ms}`;
}

function updateTimeLabel(element, seconds) {
  element.textContent = formatTime(seconds);
}

function updateClipDurationDisplay() {
  const start = parseFloat(startRangeInput.value);
  const end = parseFloat(endRangeInput.value);
  const diff = Math.max(0, end - start);
  clipDurationDisplay.textContent = `Duration: ${diff.toFixed(1)}s`;
}

// Capture Playhead Current Time
function captureStartTime() {
  if (!activePlayer) return;
  const curTime = activePlayer.getCurrentTime();
  const end = parseFloat(endRangeInput.value);
  
  const targetStart = curTime > end ? end : curTime;
  updateStartTime(targetStart);
}

function captureEndTime() {
  if (!activePlayer) return;
  const curTime = activePlayer.getCurrentTime();
  const start = parseFloat(startRangeInput.value);
  
  const targetEnd = curTime < start ? start : curTime;
  updateEndTime(targetEnd);
}

// Handle nudge button presses
function handleNudgeTime(event) {
  const button = event.currentTarget;
  const target = button.dataset.target; // 'start' or 'end'
  const amount = parseFloat(button.dataset.amount);

  if (target === 'start') {
    let newVal = parseFloat(startRangeInput.value) + amount;
    if (newVal < 0) newVal = 0;
    if (newVal > parseFloat(endRangeInput.value)) newVal = parseFloat(endRangeInput.value);
    updateStartTime(newVal);
  } else {
    let newVal = parseFloat(endRangeInput.value) + amount;
    if (newVal > currentVideoDuration) newVal = currentVideoDuration;
    if (newVal < parseFloat(startRangeInput.value)) newVal = parseFloat(startRangeInput.value);
    updateEndTime(newVal);
  }
}

// Toggle Playback / Previewing state
function togglePreviewPlayback() {
  if (!activePlayer) return;

  const state = activePlayer.player.getPlayerState();
  if (state === 1) { // Playing
    activePlayer.pause();
  } else {
    // Seek to start parameter when clicking play/preview to start fresh
    const start = parseFloat(startRangeInput.value);
    activePlayer.seekTo(start);
    activePlayer.play();
  }
}

function handleLoopToggleChange() {
  if (activePlayer) {
    activePlayer.setLoop(loopClipToggle.checked);
  }
}

// Update Play State indicators
function updatePlayerStateBadge(state) {
  // YT.PlayerState definitions:
  // UNSTARTED = -1, ENDED = 0, PLAYING = 1, PAUSED = 2, BUFFERING = 3, CUED = 5
  if (state === 1) {
    playerStateBadge.textContent = 'Playing';
    playerStateBadge.classList.add('playing');
    previewClipBtn.querySelector('span').textContent = 'Pause Preview';
    // Swap icon to pause
    previewClipBtn.querySelector('svg').innerHTML = '<rect x="6" y="4" width="4" height="16"></rect><rect x="14" y="4" width="4" height="16"></rect>';
  } else {
    playerStateBadge.textContent = state === 3 ? 'Buffering' : 'Paused';
    playerStateBadge.classList.remove('playing');
    previewClipBtn.querySelector('span').textContent = 'Play/Preview Clip';
    // Swap icon back to play
    previewClipBtn.querySelector('svg').innerHTML = '<polygon points="5 3 19 12 5 21 5 3"></polygon>';
  }
}

// Save Clip Form Submission
async function handleSaveFormSubmit(event) {
  if (!activePlayer) return;

  const title = clipTitleInput.value.trim();
  const description = clipNotesInput.value.trim();
  const tagsStr = clipTagsInput.value.trim();
  const channelId = uploadChannelSelect.value;
  const playlistId = uploadPlaylistSelect.value;
  
  const clipData = {
    id: editingClipId || undefined,
    title: title || 'Untitled Clip',
    description: description,
    videoId: activePlayer.currentVideoId,
    videoTitle: (currentVideoDetails && currentVideoDetails.title) || 'YouTube Video',
    startTime: parseFloat(startRangeInput.value),
    endTime: parseFloat(endRangeInput.value),
    tags: tagsStr
  };

  // 1. Save metadata locally first
  saveClip(clipData);

  // 2. Reset local metadata form fields
  clipTitleInput.value = `Clip from ${clipData.videoTitle}`;
  clipNotesInput.value = '';
  clipTagsInput.value = '';
  editingClipId = null;
  renderLibrary();

  // 3. If publishing to YouTube is requested
  if (channelId && channelId !== 'none' && channelId !== 'connect') {
    await uploadToYouTubeChannel(clipData, channelId, playlistId);
  } else if (channelId === 'none') {
    // Automatically trigger local clip download when saving to library
    await downloadClip(clipData.videoId, clipData.startTime, clipData.endTime, clipData.title, saveClipBtn);
  }
}

// Render library list
function renderLibrary(query = '') {
  const clips = query ? searchClips(query) : getClips();

  // Show/Hide global clear button
  const allClips = getClips();
  if (allClips.length > 0) {
    clearAllLibraryBtn.classList.remove('hidden');
  } else {
    clearAllLibraryBtn.classList.add('hidden');
  }

  // Handle empty state
  if (clips.length === 0) {
    savedClipsContainer.innerHTML = '';
    savedClipsContainer.appendChild(libraryEmptyState);
    libraryEmptyState.classList.remove('hidden');
    return;
  }

  libraryEmptyState.classList.add('hidden');
  savedClipsContainer.innerHTML = '';

  clips.forEach(clip => {
    const card = document.createElement('div');
    card.className = 'saved-clip-card';
    card.dataset.id = clip.id;

    // Click handler to load the clip
    card.addEventListener('click', (e) => {
      // Don't trigger if user is clicking action buttons inside the card
      if (e.target.closest('.btn-action') || e.target.closest('svg') || e.target.closest('button')) {
        return;
      }
      loadSavedClip(clip);
    });

    const duration = clip.endTime - clip.startTime;
    const thumbnail = `https://img.youtube.com/vi/${clip.videoId}/mqdefault.jpg`;

    // Render tag badges
    const tagsHtml = clip.tags.map(tag => `<span class="clip-tag">#${tag}</span>`).join('');

    card.innerHTML = `
      <div class="clip-thumbnail-wrapper">
        <img class="clip-thumbnail" src="${thumbnail}" alt="Thumbnail">
        <span class="clip-duration-badge">${duration.toFixed(1)}s</span>
      </div>
      <div class="clip-card-details">
        <div class="clip-card-header">
          <div class="clip-card-title" title="${clip.title}">${clip.title}</div>
        </div>
        <div class="clip-card-meta" title="${clip.videoTitle}">${clip.videoTitle}</div>
        <div class="clip-tags-row">${tagsHtml}</div>
        <div class="clip-card-actions">
          <button class="btn btn-icon-only btn-action download-clip-btn" title="Download MP4">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
              <polyline points="7 10 12 15 17 10"></polyline>
              <line x1="12" y1="15" x2="12" y2="3"></line>
            </svg>
          </button>
          <button class="btn btn-icon-only btn-action share-clip-btn" title="Share Clip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="18" cy="5" r="3"></circle>
              <circle cx="6" cy="12" r="3"></circle>
              <circle cx="18" cy="19" r="3"></circle>
              <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"></line>
              <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"></line>
            </svg>
          </button>
          <button class="btn btn-icon-only btn-action edit-clip-btn" title="Edit Metadata">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
              <path d="M18.5 2.5a2.121 2.121 0 1 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
            </svg>
          </button>
          <button class="btn btn-icon-only btn-action delete-clip-btn" title="Delete Clip">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="3 6 5 6 21 6"></polyline>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
              <line x1="10" y1="11" x2="10" y2="17"></line>
              <line x1="14" y1="11" x2="14" y2="17"></line>
            </svg>
          </button>
        </div>
      </div>
    `;

    // Hook events inside the list items
    card.querySelector('.download-clip-btn').addEventListener('click', (e) => {
      e.stopPropagation();
      const btn = card.querySelector('.download-clip-btn');
      downloadClip(clip.videoId, clip.startTime, clip.endTime, clip.title, btn);
    });
    card.querySelector('.share-clip-btn').addEventListener('click', () => showShareModal(clip));
    card.querySelector('.edit-clip-btn').addEventListener('click', () => startEditingClip(clip));
    card.querySelector('.delete-clip-btn').addEventListener('click', () => handleDeleteClip(clip.id));

    savedClipsContainer.appendChild(card);
  });
}

// Load a saved clip back into player and settings
function loadSavedClip(clip) {
  urlInput.value = `https://www.youtube.com/watch?v=${clip.videoId}`;
  
  // Check if it is the same video, if so just seek and set boundaries
  if (activePlayer && activePlayer.currentVideoId === clip.videoId) {
    updateStartTime(clip.startTime);
    updateEndTime(clip.endTime);
    activePlayer.seekTo(clip.startTime);
    activePlayer.play();
    
    // Fill out form in case they want to modify it
    clipTitleInput.value = clip.title;
    clipNotesInput.value = clip.description;
    clipTagsInput.value = clip.tags.join(', ');
    editingClipId = clip.id;
  } else {
    // Load new video first, then apply ranges
    loadVideo(clip.videoId, () => {
      updateStartTime(clip.startTime);
      updateEndTime(clip.endTime);
      activePlayer.seekTo(clip.startTime);
      activePlayer.play();
      
      clipTitleInput.value = clip.title;
      clipNotesInput.value = clip.description;
      clipTagsInput.value = clip.tags.join(', ');
      editingClipId = clip.id;
    });
  }
}

// Setup form for editing
function startEditingClip(clip) {
  loadSavedClip(clip);
  // Smooth scroll user to metadata form card
  saveFormCard.scrollIntoView({ behavior: 'smooth' });
}

// Delete Action
function handleDeleteClip(id) {
  if (confirm('Are you sure you want to delete this clip?')) {
    deleteClip(id);
    if (editingClipId === id) {
      editingClipId = null;
      clipTitleInput.value = (currentVideoDetails && `Clip from ${currentVideoDetails.title}`) || '';
      clipNotesInput.value = '';
      clipTagsInput.value = '';
    }
    renderLibrary(librarySearchInput.value);
  }
}

// Clear all clips
function handleClearAllLibrary() {
  if (confirm('Are you sure you want to delete ALL clips from your library? This cannot be undone.')) {
    clearAllClips();
    editingClipId = null;
    renderLibrary();
  }
}

// Display sharing URLs
function showShareModal(clip) {
  const origin = window.location.origin + window.location.pathname;
  const videoId = clip.videoId;
  const start = clip.startTime.toFixed(1);
  const end = clip.endTime.toFixed(1);
  const titleEnc = encodeURIComponent(clip.title);

  // App link
  const appLink = `${origin}?v=${videoId}&start=${start}&end=${end}&title=${titleEnc}`;
  shareAppLinkInput.value = appLink;

  // YT Direct link
  // Direct clip playback on YouTube embeds requires: loop=1, playlist=VIDEO_ID, start=START_SEC, end=END_SEC
  const ytLink = `https://www.youtube.com/embed/${videoId}?start=${Math.floor(clip.startTime)}&end=${Math.ceil(clip.endTime)}&autoplay=1&loop=1&playlist=${videoId}`;
  shareYtLinkInput.value = ytLink;

  shareModal.classList.remove('hidden');
}

function hideShareModal() {
  shareModal.classList.add('hidden');
  
  // Clear copy buttons styles
  copyButtons.forEach(btn => {
    btn.classList.remove('copied');
    btn.querySelector('span').textContent = 'Copy';
  });
}

// Copy sharing URLs to clipboard
async function handleCopyLink(event) {
  const btn = event.currentTarget;
  const targetId = btn.dataset.target;
  const inputEl = document.getElementById(targetId);

  if (!inputEl) return;

  try {
    await navigator.clipboard.writeText(inputEl.value);
    btn.classList.add('copied');
    btn.querySelector('span').textContent = 'Copied!';
    
    // Revert back after 2 seconds
    setTimeout(() => {
      btn.classList.remove('copied');
      btn.querySelector('span').textContent = 'Copy';
    }, 2000);
  } catch (err) {
    console.error('Failed to copy to clipboard:', err);
    alert('Failed to copy. Please copy the text manually from the input field.');
  }
}

// ==========================================
// YouTube API & OAuth Upload Feature
// ==========================================

let connectedChannels = [];

let isServerOAuthConfigured = false;

// Initialize and load saved OAuth secrets
async function initYouTubeIntegration() {
  const savedClientId = localStorage.getItem('clapclip_google_client_id');
  const savedClientSecret = localStorage.getItem('clapclip_google_client_secret');

  if (savedClientId) oauthClientId.value = savedClientId;
  if (savedClientSecret) oauthClientSecret.value = savedClientSecret;

  // Check server configuration
  try {
    const configRes = await fetch('/api/config');
    if (configRes.ok) {
      const configData = await configRes.json();
      isServerOAuthConfigured = !!configData.hasEnvCredentials;
    }
  } catch (err) {
    console.error('Failed to load server configuration:', err);
  }

  // Toggle UI elements in modal based on configuration
  const banner = document.getElementById('oauth-status-banner');
  const inputs = document.getElementById('oauth-credentials-inputs');
  const desc = document.getElementById('oauth-modal-description');

  if (isServerOAuthConfigured) {
    if (banner) banner.classList.remove('hidden');
    if (inputs) inputs.classList.add('hidden');
    if (desc) desc.classList.add('hidden');
  } else {
    if (banner) banner.classList.add('hidden');
    if (inputs) inputs.classList.remove('hidden');
    if (desc) desc.classList.remove('hidden');
  }

  // Load connected channels from DB
  loadConnectedChannels();
}

// Switch view tabs
function switchTab(tabId) {
  document.querySelectorAll('.tab-btn').forEach(btn => {
    if (btn.dataset.tab === tabId) {
      btn.classList.add('active');
    } else {
      btn.classList.remove('active');
    }
  });

  document.querySelectorAll('.tab-pane').forEach(pane => {
    if (pane.id === tabId) {
      pane.classList.add('active-pane');
    } else {
      pane.classList.remove('active-pane');
    }
  });

  if (tabId === 'dashboard-tab') {
    loadConnectedChannels();
    loadUploadLogs();
  }
}

// Retrieve connected channels list from server
async function loadConnectedChannels() {
  try {
    const res = await fetch('/api/channels');
    if (!res.ok) throw new Error('Failed to retrieve channels from server.');
    connectedChannels = await res.json();
    
    populateChannelsDropdown();
    renderChannelsDashboardGrid();
  } catch (err) {
    console.error('Error loading channels:', err);
  }
}

// Populate the channels dropdown select input
function populateChannelsDropdown() {
  uploadChannelSelect.innerHTML = `
    <option value="none">Local Library Only (No Upload)</option>
  `;

  connectedChannels.forEach(channel => {
    const opt = document.createElement('option');
    opt.value = channel.channelId;
    opt.textContent = channel.channelName;
    uploadChannelSelect.appendChild(opt);
  });

  const connectOpt = document.createElement('option');
  connectOpt.value = 'connect';
  connectOpt.textContent = '+ Connect New Channel...';
  uploadChannelSelect.appendChild(connectOpt);
}

// Render connected channels grid cards on dashboard tab
function renderChannelsDashboardGrid() {
  const grid = document.getElementById('channels-list-grid');
  if (!grid) return;

  if (connectedChannels.length === 0) {
    grid.innerHTML = `
      <div class="channels-empty-state">
        <p>No YouTube channels connected yet. Click "+ Connect Channel" above to authorize a channel.</p>
      </div>
    `;
    return;
  }

  grid.innerHTML = '';
  connectedChannels.forEach(channel => {
    const card = document.createElement('div');
    card.className = 'channel-dashboard-card';
    card.dataset.id = channel.channelId;

    const statusLabel = channel.status === 'connected' ? 'Connected' : (channel.status === 'expired' ? 'Expired' : 'Needs Reauthorization');
    const badgeClass = channel.status === 'connected' ? 'connected' : (channel.status === 'expired' ? 'expired' : 'needs_reauth');

    card.innerHTML = `
      <div class="channel-card-info">
        <img class="channel-card-avatar" src="${channel.channelAvatar || 'https://via.placeholder.com/48'}" alt="${channel.channelName}">
        <div class="channel-card-details">
          <span class="channel-card-name" title="${channel.channelName}">${channel.channelName}</span>
          <span class="health-badge ${badgeClass}">${statusLabel}</span>
        </div>
      </div>
      <div class="channel-card-actions">
        <button class="btn btn-secondary sync-playlists-btn">Sync Playlists</button>
        <button class="btn btn-text-danger disconnect-btn">Disconnect</button>
      </div>
    `;

    card.querySelector('.sync-playlists-btn').addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      const originalText = btn.textContent;
      btn.textContent = 'Syncing...';
      btn.disabled = true;
      try {
        await syncPlaylists(channel.channelId);
        alert(`Playlists synced successfully for ${channel.channelName}!`);
      } catch (err) {
        alert(`Failed to sync playlists: ${err.message}`);
      } finally {
        btn.textContent = originalText;
        btn.disabled = false;
      }
    });

    card.querySelector('.disconnect-btn').addEventListener('click', async () => {
      if (confirm(`Are you sure you want to disconnect channel ${channel.channelName}?`)) {
        try {
          await disconnectChannel(channel.channelId);
        } catch (err) {
          alert(`Failed to disconnect channel: ${err.message}`);
        }
      }
    });

    grid.appendChild(card);
  });
}

// Sync playlists list with server
async function syncPlaylists(channelId) {
  const res = await fetch('/api/playlists/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId })
  });
  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || 'Server failed to sync playlists.');
  }
  
  if (uploadChannelSelect.value === channelId) {
    await loadPlaylistsForChannel(channelId);
  }
}

// Delete channel from server
async function disconnectChannel(channelId) {
  const res = await fetch('/api/channels/delete', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ channelId })
  });
  if (!res.ok) {
    throw new Error('Failed to delete channel from server.');
  }
  
  if (uploadChannelSelect.value === channelId) {
    uploadChannelSelect.value = 'none';
    handleChannelSelectChange();
  }
  
  await loadConnectedChannels();
}

// Load and render upload logs history in dashboard
async function loadUploadLogs() {
  const tbody = document.getElementById('upload-logs-tbody');
  if (!tbody) return;

  try {
    const res = await fetch('/api/uploads');
    if (!res.ok) throw new Error('Failed to retrieve logs.');
    const logs = await res.json();

    if (logs.length === 0) {
      tbody.innerHTML = `
        <tr>
          <td colspan="6" class="table-empty-state">No upload history found.</td>
        </tr>
      `;
      return;
    }

    tbody.innerHTML = '';
    logs.forEach(log => {
      const dateStr = new Date(log.createdAt).toLocaleString();
      const duration = (log.endTime - log.startTime).toFixed(1);
      
      let statusHtml = '';
      if (log.status === 'completed') {
        statusHtml = `<span class="status-badge completed">Completed</span>`;
      } else if (log.status === 'failed') {
        statusHtml = `<span class="status-badge failed error-cell" data-error="${log.errorMessage || 'Unknown error'}">Failed</span>`;
      } else if (log.status === 'uploading') {
        statusHtml = `<span class="status-badge uploading">Uploading</span>`;
      } else {
        statusHtml = `<span class="status-badge pending">Pending</span>`;
      }

      const playlistTitleText = log.playlistTitle || 'No Playlist';
      
      const actionHtml = log.youtubeVideoId 
        ? `<a href="https://www.youtube.com/watch?v=${log.youtubeVideoId}" target="_blank" class="btn btn-secondary btn-icon-only" title="Watch on YouTube" style="width:28px;height:28px;border-radius:6px;display:inline-flex;">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="width:14px;height:14px;"><polygon points="5 3 19 12 5 21 5 3"></polygon></svg>
           </a>`
        : '-';

      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${dateStr}</td>
        <td>
          <div style="font-weight:600;">${log.title}</div>
          <div style="font-size:0.75rem;color:var(--text-muted);">Video: ${log.videoId} (${duration}s)</div>
        </td>
        <td>${log.channelName || 'Disconnected Channel'}</td>
        <td>${playlistTitleText}</td>
        <td>${statusHtml}</td>
        <td>${actionHtml}</td>
      `;
      tbody.appendChild(tr);
    });
  } catch (err) {
    console.error('Error loading uploads:', err);
    tbody.innerHTML = `
      <tr>
        <td colspan="6" class="table-empty-state" style="color:var(--danger);">Failed to load upload history logs.</td>
      </tr>
    `;
  }
}

// Handle changes on YouTube Channel Dropdown select
function handleChannelSelectChange() {
  const val = uploadChannelSelect.value;
  const labelSpan = saveClipBtn.querySelector('span');

  if (val === 'connect') {
    authModal.classList.remove('hidden');
    uploadChannelSelect.value = 'none';
    playlistGroup.classList.add('hidden');
    if (labelSpan) labelSpan.textContent = 'Save Clip to Library';
    return;
  }

  if (val === 'none') {
    playlistGroup.classList.add('hidden');
    if (labelSpan) labelSpan.textContent = 'Save Clip to Library';
  } else {
    playlistGroup.classList.remove('hidden');
    if (labelSpan) labelSpan.textContent = 'Save & Upload to YouTube';
    loadPlaylistsForChannel(val);
  }
}

// Load Playlists from YouTube API cache/sync for chosen channel
async function loadPlaylistsForChannel(channelId) {
  uploadPlaylistSelect.innerHTML = '<option value="">Loading playlists...</option>';
  uploadPlaylistSelect.disabled = true;

  try {
    const res = await fetch('/api/playlists', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ channelId })
    });

    if (!res.ok) {
      throw new Error('Server failed to retrieve playlists.');
    }

    const data = await res.json();
    uploadPlaylistSelect.innerHTML = '<option value="">No Playlist (Upload Only)</option>';
    
    data.playlists.forEach(p => {
      const opt = document.createElement('option');
      opt.value = p.id;
      opt.textContent = p.title;
      uploadPlaylistSelect.appendChild(opt);
    });

    uploadPlaylistSelect.disabled = false;

  } catch (err) {
    console.error('Failed to load playlists:', err);
    uploadPlaylistSelect.innerHTML = '<option value="">Failed to load playlists</option>';
  }
}

// Trigger Google OAuth window redirect process
function handleTriggerOAuth() {
  let url = '/api/auth';

  if (!isServerOAuthConfigured) {
    const clientId = oauthClientId.value.trim();
    const clientSecret = oauthClientSecret.value.trim();

    if (!clientId || !clientSecret) {
      alert('Please enter both Client ID and Client Secret.');
      return;
    }

    localStorage.setItem('clapclip_google_client_id', clientId);
    localStorage.setItem('clapclip_google_client_secret', clientSecret);
    url += `?clientId=${clientId}&clientSecret=${clientSecret}`;
  }

  const width = 600;
  const height = 650;
  const left = window.top.outerWidth / 2 + window.top.screenX - width / 2;
  const top = window.top.outerHeight / 2 + window.top.screenY - height / 2;

  window.open(url, 'Google OAuth Authorize', `width=${width},height=${height},left=${left},top=${top}`);
}

// Listen for popup auth messaging completion
function handleOAuthMessage(event) {
  if (event.origin !== window.location.origin) return;

  if (event.data && event.data.type === 'YOUTUBE_AUTH_SUCCESS') {
    const authData = event.data.data;
    alert(`Successfully authorized channel: ${authData.channelName}`);
    authModal.classList.add('hidden');
    
    loadConnectedChannels().then(() => {
      uploadChannelSelect.value = authData.channelId;
      handleChannelSelectChange();
    });
  }
}

// Upload Clip to YouTube Channel & Playlist
async function uploadToYouTubeChannel(clipData, channelId, playlistId) {
  const originalContent = saveClipBtn.innerHTML;
  saveClipBtn.classList.add('loading');
  saveClipBtn.disabled = true;

  const labelSpan = saveClipBtn.querySelector('span');
  if (labelSpan) labelSpan.textContent = 'Uploading Clip...';

  try {
    const payload = {
      v: activePlayer.currentVideoId,
      start: clipData.startTime,
      end: clipData.endTime,
      title: clipData.title,
      description: clipData.description,
      playlistId: playlistId || undefined,
      channelId: channelId
    };

    const res = await fetch('/api/upload-youtube', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!res.ok) {
      const errData = await res.json().catch(() => ({}));
      throw new Error(errData.error || 'Server failed to upload video.');
    }

    const data = await res.json();
    alert(`Successfully uploaded to YouTube!\nVideo Link: ${data.youtubeUrl}`);

  } catch (err) {
    console.error('YouTube upload failed:', err);
    alert(`YouTube Upload Error: ${err.message}`);
  } finally {
    saveClipBtn.classList.remove('loading');
    saveClipBtn.disabled = false;
    saveClipBtn.innerHTML = originalContent;

    uploadChannelSelect.value = 'none';
    playlistGroup.classList.add('hidden');
    if (labelSpan) labelSpan.textContent = 'Save Clip to Library';
  }
}

// Handle triggering local clip download from Vite backend
async function downloadClip(videoId, start, end, title, button) {
  if (!videoId) return;

  const originalContent = button.innerHTML;
  button.classList.add('loading');
  button.disabled = true;

  const textSpan = button.querySelector('span');
  if (textSpan) {
    textSpan.textContent = 'Downloading...';
  }

  try {
    const url = `/api/download?v=${videoId}&start=${start.toFixed(1)}&end=${end.toFixed(1)}&title=${encodeURIComponent(title)}`;
    const response = await fetch(url);

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || 'Server failed to compile and download clip.');
    }

    const blob = await response.blob();
    const downloadUrl = window.URL.createObjectURL(blob);
    
    const a = document.createElement('a');
    a.href = downloadUrl;
    a.download = `${title.replace(/[^a-z0-9_-]/gi, '_').toLowerCase()}.mp4`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    
    window.URL.revokeObjectURL(downloadUrl);

  } catch (err) {
    console.error('Download failed:', err);
    alert(`Download Error: ${err.message}`);
  } finally {
    button.classList.remove('loading');
    button.disabled = false;
    button.innerHTML = originalContent;
  }
}
