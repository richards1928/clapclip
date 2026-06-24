const STORAGE_KEY = 'clapclip_saved_clips';

/**
 * Get all saved clips from localStorage
 * @returns {Array} List of clip objects
 */
export function getClips() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (error) {
    console.error('Error reading saved clips from localStorage:', error);
    return [];
  }
}

/**
 * Save a new clip to localStorage or update an existing one
 * @param {Object} clip - Clip metadata object
 * @returns {Array} Updated list of saved clips
 */
export function saveClip(clip) {
  const clips = getClips();
  
  const newClip = {
    id: clip.id || Date.now().toString(),
    title: clip.title || 'Untitled Clip',
    description: clip.description || '',
    videoId: clip.videoId,
    videoTitle: clip.videoTitle || 'YouTube Video',
    startTime: parseFloat(clip.startTime) || 0,
    endTime: parseFloat(clip.endTime) || 0,
    tags: Array.isArray(clip.tags) 
      ? clip.tags 
      : (clip.tags ? clip.tags.split(',').map(t => t.trim()).filter(Boolean) : []),
    createdAt: clip.createdAt || new Date().toISOString()
  };

  const existingIndex = clips.findIndex(c => c.id === newClip.id);
  
  if (existingIndex > -1) {
    clips[existingIndex] = newClip;
  } else {
    clips.unshift(newClip); // Add to the top of the library list
  }

  localStorage.setItem(STORAGE_KEY, JSON.stringify(clips));
  return clips;
}

/**
 * Delete a clip from localStorage by ID
 * @param {string} id - The ID of the clip to delete
 * @returns {Array} Updated list of saved clips
 */
export function deleteClip(id) {
  const clips = getClips();
  const filteredClips = clips.filter(clip => clip.id !== id);
  localStorage.setItem(STORAGE_KEY, JSON.stringify(filteredClips));
  return filteredClips;
}

/**
 * Clear all clips from the database
 */
export function clearAllClips() {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Search clips by text matching title, description, videoTitle, or tags
 * @param {string} query - The search string
 * @returns {Array} Filtered list of clips
 */
export function searchClips(query) {
  const clips = getClips();
  if (!query) return clips;
  
  const cleanQuery = query.toLowerCase().trim();
  
  return clips.filter(clip => {
    const titleMatch = clip.title.toLowerCase().includes(cleanQuery);
    const descMatch = clip.description.toLowerCase().includes(cleanQuery);
    const videoTitleMatch = clip.videoTitle.toLowerCase().includes(cleanQuery);
    const tagsMatch = clip.tags.some(tag => tag.toLowerCase().includes(cleanQuery));
    
    return titleMatch || descMatch || videoTitleMatch || tagsMatch;
  });
}
