// Cache for storing discovered clips
let clipsCache = null;
let cacheMetadata = null;
const CACHE_DURATION_MS = 5 * 60 * 1000; // 5 minutes in milliseconds

// Retry utility for network requests with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries) {
                console.error(`Failed after ${maxRetries} attempts:`, error);
                throw error;
            }
            
            const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
            console.log(`Attempt ${attempt} failed, retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}

// Function to check if cache is valid and clear if expired
function isCacheValid(channelId, startDate, endDate, accountList = [], listMode = 'none', maxGap = 0, coverageThreshold = 0.95) {
    if (!clipsCache || !cacheMetadata) {
        return false;
    }
    
    // Check if cache has expired (5 minutes)
    const now = Date.now();
    if (now - cacheMetadata.timestamp > CACHE_DURATION_MS) {
        console.log('Cache expired (older than 5 minutes) - clearing cache');
        // Clear expired cache
        clipsCache = null;
        cacheMetadata = null;
        return false;
    }
    
    // Check if parameters match
    if (cacheMetadata.channelId !== channelId ||
        cacheMetadata.startDate !== startDate ||
        cacheMetadata.endDate !== endDate) {
        console.log('Cache parameters do not match - cache invalid');
        return false;
    }
    
    // Check if account list settings match
    const cachedAccountList = cacheMetadata.accountList || [];
    const cachedListMode = cacheMetadata.listMode || 'none';
    
    if (cachedListMode !== listMode) {
        console.log('Cache list mode does not match - cache invalid');
        return false;
    }
    
    if (JSON.stringify(cachedAccountList.sort()) !== JSON.stringify(accountList.sort())) {
        console.log('Cache account list does not match - cache invalid');
        return false;
    }
    
    // Check if filtering settings match
    const cachedMaxGap = cacheMetadata.maxGap ?? 0;
    const cachedCoverageThreshold = cacheMetadata.coverageThreshold ?? 0.95;
    
    if (cachedMaxGap !== maxGap || Math.abs(cachedCoverageThreshold - coverageThreshold) > 0.001) {
        console.log('Cache filtering settings do not match - cache invalid');
        return false;
    }
    
    return true;
}

// Listen for messages from popup or content scripts
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'button1Action') {
        handleButton1Action(request.data, sender.tab?.id).then(sendResponse);
        return true; // Keep message channel open for async response
    }
    
    if (request.action === 'button2Action') {
        handleButton2Action(request.data).then(sendResponse);
        return true;
    }
});

// Handle button 1 action - Filter and download clips
async function handleButton1Action(data, tabId) {
    console.log('Background received button1 action');
    
    // Helper function to send progress updates
    function sendProgress(message) {
        chrome.runtime.sendMessage({ 
            action: 'downloadProgress', 
            message: message 
        }).catch(() => {
            // Ignore errors if popup is closed
        });
    }
    
    try {
        let clips;
        let originalCount;
        
        // Check if we can use cached data
        if (isCacheValid(data.channelId, data.startDate, data.endDate, data.accountList || [], data.listMode || 'none', data.maxGap || 0, data.coverageThreshold || 0.95)) {
            console.log('Using cached clip data (already filtered by account list)');
            const cacheAge = Math.floor((Date.now() - cacheMetadata.timestamp) / 1000);
            console.log(`Cache age: ${cacheAge} seconds`);
            clips = clipsCache;
            originalCount = cacheMetadata.originalCount || clips.length;
        } else {
            console.log('Cache miss, expired, or invalid - fetching and filtering clips...');
            const fetchedClips = await fetchClipsByDateRange(
                data.channelId,
                data.userId,
                data.oauthToken,
                data.startDate,
                data.endDate
            );
            
            originalCount = fetchedClips.length;
            
            // Apply whitelist/blacklist filtering
            clips = applyAccountListFilter(fetchedClips, data.accountList || [], data.listMode || 'none');
            
            console.log(`Filtering complete: ${originalCount} → ${clips.length} clips (${originalCount - clips.length} filtered by account list)`);
            
            // Update cache with filtered clips and metadata
            clipsCache = clips;
            cacheMetadata = {
                channelId: data.channelId,
                startDate: data.startDate,
                endDate: data.endDate,
                accountList: data.accountList || [],
                listMode: data.listMode || 'none',
                maxGap: data.maxGap || 0,
                coverageThreshold: data.coverageThreshold || 0.95,
                originalCount: originalCount,
                timestamp: Date.now()
            };
        }
        
        console.log(`Starting redundancy filtering on ${clips.length} clips...`);
        
        // Separate clips with and without offset data
        const clipsWithNullOffset = clips.filter(clip => clip.vod_offset === null || clip.vod_offset === undefined);
        const clipsWithValidOffset = clips.filter(clip => clip.vod_offset !== null && clip.vod_offset !== undefined);
        
        let filteredClips;
        
        if (clipsWithNullOffset.length > 0) {
            console.warn(`⚠️ ${clipsWithNullOffset.length} clips have null vod_offset - these will be kept without filtering`);
            sendProgress(`⚠️ Warning: ${clipsWithNullOffset.length}/${clips.length} clips missing timeline data - filtering only clips with valid offsets`);
            
            // Filter only clips with valid offsets
            const filteredValidOffsetClips = filterRedundantClips(
                clipsWithValidOffset,
                data.maxGap || 0,
                data.coverageThreshold || 0.95
            );
            
            // Combine filtered clips with null offset clips
            filteredClips = [...filteredValidOffsetClips, ...clipsWithNullOffset];
            console.log(`Filtering complete: ${clipsWithValidOffset.length} clips with offsets → ${filteredValidOffsetClips.length} (${clipsWithValidOffset.length - filteredValidOffsetClips.length} removed), ${clipsWithNullOffset.length} null offset clips kept`);
        } else {
            // All clips have valid offsets, filter normally
            filteredClips = filterRedundantClips(
                clips,
                data.maxGap || 0,
                data.coverageThreshold || 0.95
            );
            console.log(`Filtering complete: ${clips.length} → ${filteredClips.length} clips (${clips.length - filteredClips.length} total clips removed)`);
        }
        
        // Download the filtered clips
        console.log('Starting download process...');
        const downloadResult = await downloadClips(filteredClips, data.channelId, data.editorId, data.userId, data.oauthToken, sendProgress);
        
        // Calculate total duration of filtered clips
        const totalDuration = filteredClips.reduce((sum, clip) => sum + (clip.duration || 0), 0);
        
        return { 
            success: true, 
            clips: filteredClips, 
            count: filteredClips.length, 
            originalCount: originalCount,
            downloaded: downloadResult.successful,
            failed: downloadResult.failed,
            totalDuration: totalDuration
        };
    } catch (error) {
        console.error('Error in button1 action:', error);
        return { success: false, error: error.message };
    }
}

// Handle button 2 action - Discover clips only
async function handleButton2Action(data) {
    console.log('Background received button2 action - Starting clip discovery');
    
    try {
        const scanDuration = data.scanDuration || 10; // Default to 10 seconds
        
        const clips = await fetchClipsByDateRange(
            data.channelId,
            data.userId,
            data.oauthToken,
            data.startDate,
            data.endDate,
            scanDuration
        );
        
        console.log(`Clip discovery complete. Found ${clips.length} clips.`);
        
        // Apply whitelist/blacklist filtering
        const accountFilteredClips = applyAccountListFilter(clips, data.accountList || [], data.listMode || 'none');
        
        console.log(`Account filtering complete: ${clips.length} → ${accountFilteredClips.length} clips (${clips.length - accountFilteredClips.length} filtered by account list)`);
        
        // Separate clips with and without offset data
        const clipsWithNullOffset = accountFilteredClips.filter(clip => clip.vod_offset === null || clip.vod_offset === undefined);
        const clipsWithValidOffset = accountFilteredClips.filter(clip => clip.vod_offset !== null && clip.vod_offset !== undefined);
        
        let filteredClips;
        let partialFilteringApplied = false;
        
        if (clipsWithNullOffset.length > 0) {
            console.warn(`⚠️ ${clipsWithNullOffset.length} clips have null vod_offset - filtering only clips with valid offsets`);
            partialFilteringApplied = true;
            
            // Filter only clips with valid offsets
            const filteredValidOffsetClips = filterRedundantClips(
                clipsWithValidOffset,
                data.maxGap || 0,
                data.coverageThreshold || 0.95
            );
            
            // Combine filtered clips with null offset clips
            filteredClips = [...filteredValidOffsetClips, ...clipsWithNullOffset];
            console.log(`Filtering complete: ${clipsWithValidOffset.length} clips with offsets → ${filteredValidOffsetClips.length} (${clipsWithValidOffset.length - filteredValidOffsetClips.length} removed), ${clipsWithNullOffset.length} null offset clips kept`);
        } else {
            // All clips have valid offsets, filter normally
            filteredClips = filterRedundantClips(
                accountFilteredClips,
                data.maxGap || 0,
                data.coverageThreshold || 0.95
            );
        }
        
        console.log(`All filtering complete: ${clips.length} → ${filteredClips.length} clips total`);
        
        // Cache the FILTERED results with timestamp
        clipsCache = filteredClips;
        cacheMetadata = {
            channelId: data.channelId,
            startDate: data.startDate,
            endDate: data.endDate,
            accountList: data.accountList || [],
            listMode: data.listMode || 'none',
            maxGap: data.maxGap || 0,
            coverageThreshold: data.coverageThreshold || 0.95,
            originalCount: clips.length,
            timestamp: Date.now()
        };
        
        // Calculate total duration of filtered clips
        const totalDuration = filteredClips.reduce((sum, clip) => sum + (clip.duration || 0), 0);
        
        return { 
            success: true, 
            count: filteredClips.length,
            originalCount: clips.length,
            message: `Found ${filteredClips.length} clips`,
            totalDuration: totalDuration,
            scanDurationMs: scanDuration * 1000, // Convert seconds to ms
            partialFilteringApplied: partialFilteringApplied,
            nullOffsetCount: clipsWithNullOffset.length
        };
    } catch (error) {
        console.error('Error in clip discovery:', error);
        return { success: false, error: error.message };
    }
}

// Fetch clips by date range with continuous passes for a time duration
async function fetchClipsByDateRange(broadcasterId, userId, oauthToken, startDate, endDate, durationSeconds = 10) {
    const allClipsMap = new Map(); // Use Map to track unique clips by ID
    const DURATION_MS = durationSeconds * 1000; // Convert seconds to milliseconds
    const STAGGER_DELAY_MS = 500; // 500ms delay between starting passes
    const activePassPromises = [];
    let totalPassesStarted = 0;
    const startTime = Date.now();
    
    console.log('Starting continuous multi-pass clip fetch...');
    console.log(`Broadcaster ID: ${broadcasterId}`);
    console.log(`Date range: ${startDate} to ${endDate}`);
    console.log(`Will run passes continuously for ${DURATION_MS / 1000} seconds`);
    console.log('='.repeat(50));
    
    // Function to run a single pass
    async function runPass(passNumber, delayMs = 0) {
        // Delay before starting (so passes are staggered)
        if (delayMs > 0) {
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
        
        // Check if we've exceeded the time limit before starting
        if (Date.now() - startTime >= DURATION_MS) {
            console.log(`\n⏱️ [Pass ${passNumber}] Time limit reached, not starting this pass`);
            return { passNumber, newClipsThisPass: 0, pageCount: 0, skipped: true };
        }
        
        const clipsBeforePass = allClipsMap.size;
        console.log(`\n📡 Starting Pass ${passNumber}...`);
        console.log(`  Current total: ${clipsBeforePass} unique clips`);
        
        let cursor = null;
        let hasMore = true;
        let pageCount = 0;
        let newClipsThisPass = 0;
        
        while (hasMore) {
            try {
                pageCount++;
                console.log(`  [Pass ${passNumber}] Fetching page ${pageCount}...`);
                
                const result = await fetchClipsPage(
                    broadcasterId,
                    userId,
                    oauthToken,
                    startDate,
                    endDate,
                    cursor
                );
                
                console.log(`  [Pass ${passNumber}] Page ${pageCount}: Received ${result.clips.length} clips from API`);
                
                // Filter and add only new clips
                let newInPage = 0;
                result.clips.forEach(clip => {
                    if (!allClipsMap.has(clip.id)) {
                        allClipsMap.set(clip.id, {
                            id: clip.id,
                            creator_name: clip.creator_name,
                            title: clip.title,
                            duration: clip.duration,
                            created_at: clip.created_at,
                            vod_offset: clip.vod_offset,
                            game_id: clip.game_id
                        });
                        newInPage++;
                        newClipsThisPass++;
                    }
                });
                
                console.log(`  [Pass ${passNumber}] Page ${pageCount}: ${newInPage} new clips (${result.clips.length - newInPage} duplicates)`);
                
                // Check if there are more pages
                cursor = result.cursor;
                hasMore = cursor !== null && cursor !== undefined;
            } catch (error) {
                console.error(`[Pass ${passNumber}] Error fetching clips page:`, error);
                throw error;
            }
        }
        
        const clipsAfterPass = allClipsMap.size;
        const foundNewClips = newClipsThisPass > 0;
        
        console.log(`\n✓ [Pass ${passNumber}] Complete!`);
        console.log(`  Pages fetched: ${pageCount}`);
        console.log(`  New clips found: ${newClipsThisPass}`);
        console.log(`  Total unique clips now: ${clipsAfterPass}`);
        
        return { passNumber, newClipsThisPass, pageCount, skipped: false };
    }
    
    // Start the first pass
    totalPassesStarted = 1;
    const firstPass = runPass(1);
    activePassPromises.push(firstPass);
    
    // Continue launching new passes as long as we have time
    const passLauncher = setInterval(() => {
        if (Date.now() - startTime < DURATION_MS - STAGGER_DELAY_MS) {
            totalPassesStarted++;
            console.log(`⏰ Timer triggering Pass ${totalPassesStarted}...`);
            activePassPromises.push(runPass(totalPassesStarted));
        }
    }, STAGGER_DELAY_MS);
    
    // Wait for the duration to expire
    await new Promise(resolve => setTimeout(resolve, DURATION_MS));
    
    // Stop launching new passes
    clearInterval(passLauncher);
    
    console.log(`\n⏱️ Time limit reached, waiting for active passes to complete...`);
    
    // Wait for all active passes to complete
    const passResults = await Promise.all(activePassPromises);
    
    // Filter out skipped passes
    const completedPasses = passResults.filter(r => !r.skipped);
    const elapsedTime = ((Date.now() - startTime) / 1000).toFixed(2);
    
    console.log('\n' + '='.repeat(50));
    console.log(`✓ Continuous fetch complete!`);
    console.log(`Time elapsed: ${elapsedTime} seconds`);
    console.log(`Total passes started: ${totalPassesStarted}`);
    console.log(`Total passes completed: ${completedPasses.length}`);
    console.log(`Total unique clips found: ${allClipsMap.size}`);
    console.log('='.repeat(50));
    
    // Convert Map to Array
    const allClips = Array.from(allClipsMap.values());
    
    // Sort clips by date (oldest first), then by vod_offset (earliest in stream first)
    allClips.sort((a, b) => {
        const dateA = new Date(a.created_at);
        const dateB = new Date(b.created_at);
        
        // First sort by date
        if (dateA < dateB) return -1;
        if (dateA > dateB) return 1;
        
        // If dates are equal, sort by vod_offset
        return (a.vod_offset || 0) - (b.vod_offset || 0);
    });
    
    console.log('\nClips sorted by date and stream position');
    
    // Print first 5 clips (oldest and earliest in stream)
    if (allClips.length > 0) {
        console.log('\nFirst 5 clips (oldest, earliest in stream):');
        const clipsToShow = allClips.slice(0, 5);
        clipsToShow.forEach((clip, index) => {
            console.log(`${index + 1}. "${clip.title}" by ${clip.creator_name} (${clip.created_at}, offset: ${clip.vod_offset}s)`);
        });
        console.log('');
    }
    
    return allClips;
}

// Apply whitelist/blacklist filtering to clips based on creator names
function applyAccountListFilter(clips, accountList = [], listMode = 'none') {
    if (clips.length === 0) return clips;
    
    console.log('Starting account list filtering...');
    console.log(`List mode: ${listMode}`);
    console.log(`Accounts: ${accountList.length > 0 ? accountList.join(', ') : 'None'}`);
    
    let filteredClips = clips;
    
    // If list is empty, treat as blacklist with no accounts blocked (no filtering)
    if (listMode === 'whitelist' && accountList.length > 0) {
        const beforeCount = filteredClips.length;
        filteredClips = filteredClips.filter(clip => accountList.includes(clip.creator_name));
        console.log(`Whitelist applied: ${beforeCount} → ${filteredClips.length} clips (only clips from: ${accountList.join(', ')})`);
    } else if (listMode === 'blacklist' && accountList.length > 0) {
        const beforeCount = filteredClips.length;
        filteredClips = filteredClips.filter(clip => !accountList.includes(clip.creator_name));
        console.log(`Blacklist applied: ${beforeCount} → ${filteredClips.length} clips (excluded clips from: ${accountList.join(', ')})`);
    } else {
        console.log(`No account filtering applied (list is empty or mode is 'none')`);
    }
    
    console.log(`Account list filtering complete`);
    
    return filteredClips;
}

// Helper function to check if two clips overlap in time
function clipsOverlap(clip1, clip2) {
    const start1 = Math.floor(clip1.vod_offset || 0);
    const start2 = Math.floor(clip2.vod_offset || 0);
    
    // Fast pre-filter: if clips start more than 60s apart, they can't overlap
    // (Twitch clips max out at 60 seconds)
    const MAX_CLIP_DURATION = 60;
    if (Math.abs(start1 - start2) > MAX_CLIP_DURATION) {
        return false;
    }
    
    const end1 = Math.floor(start1 + clip1.duration);
    const end2 = Math.floor(start2 + clip2.duration);
    
    // Two clips overlap if: !(end1 <= start2 || end2 <= start1)
    // Simplified: start1 < end2 && start2 < end1
    return start1 < end2 && start2 < end1;
}

// Filter out redundant clips that are fully contained within other clips
function filterRedundantClips(clips, maxGap = 0, coverageThreshold = 0.95) {
    if (clips.length === 0) return [];
    
    const startTime = performance.now();
    console.log(`Starting redundancy filtering for ${clips.length} clips...`);
    console.log(`Settings: Coverage threshold = ${(coverageThreshold * 100).toFixed(0)}%, Max gap = ${maxGap}s`);
    
    const clipsToKeep = [];
    const clipsRemoved = [];
    
    // Sort clips by duration (longest first) - we want to keep longer clips and remove shorter redundant ones
    const sortedClips = [...clips].sort((a, b) => b.duration - a.duration);
    
    // PHASE 1: Build overlap map (O(N²) comparisons)
    const overlapMap = new Map(); // clipId -> [ids of clips that overlap with it]
    let overlapCheckComparisons = 0;
    
    for (let i = 0; i < sortedClips.length; i++) {
        const clip = sortedClips[i];
        const overlappingIds = [];
        
        for (let j = 0; j < sortedClips.length; j++) {
            if (i === j) continue;
            
            overlapCheckComparisons++;
            if (clipsOverlap(clip, sortedClips[j])) {
                overlappingIds.push(sortedClips[j].id);
            }
        }
        
        overlapMap.set(clip.id, overlappingIds);
    }
    
    // PHASE 2: Filter using only overlapping clips (O(N × M × D) where M = overlaps per clip)
    let coverageCheckComparisons = 0;
    
    for (const clip of sortedClips) {
        const clipStart = Math.floor(clip.vod_offset || 0);
        const clipEnd = Math.floor(clipStart + clip.duration);
        const clipDuration = clipEnd - clipStart;
        
        if (clipDuration <= 0) {
            // Invalid clip, skip it
            continue;
        }
        
        // Get only the clips we've already kept that OVERLAP with this clip
        const overlappingIds = overlapMap.get(clip.id) || [];
        const keptClipIds = new Set(clipsToKeep.map(c => c.id));
        const relevantKeptClips = clipsToKeep.filter(c => overlappingIds.includes(c.id));
        
        coverageCheckComparisons += relevantKeptClips.length;
        
        // Create a set of all seconds covered by overlapping kept clips
        const coveredSeconds = new Set();
        
        for (const otherClip of relevantKeptClips) {
            const otherStart = Math.floor(otherClip.vod_offset || 0);
            const otherEnd = Math.floor(otherStart + otherClip.duration);
            
            // Add each second from this other clip to the covered set
            for (let second = otherStart; second < otherEnd; second++) {
                coveredSeconds.add(second);
            }
        }
        
        // Count how many seconds of the current clip are covered by other clips
        let coveredCount = 0;
        for (let second = clipStart; second < clipEnd; second++) {
            if (coveredSeconds.has(second)) {
                coveredCount++;
            }
        }
        
        // Calculate coverage percentage
        const coveragePercentage = coveredCount / clipDuration;
        
        // Check if this clip is redundant
        if (coveragePercentage >= coverageThreshold) {
            // Check if removing this clip would create a gap
            // A gap exists if there are consecutive seconds in this clip that aren't covered
            let maxGapSize = 0;
            let currentGapSize = 0;
            
            for (let second = clipStart; second < clipEnd; second++) {
                if (!coveredSeconds.has(second)) {
                    currentGapSize++;
                    maxGapSize = Math.max(maxGapSize, currentGapSize);
                } else {
                    currentGapSize = 0;
                }
            }
            
            // If the maximum gap is small (less than x seconds), consider it acceptable
            if (maxGapSize <= maxGap) {
                clipsRemoved.push({
                    clip: clip,
                    coverage: (coveragePercentage * 100).toFixed(1),
                    maxGap: maxGapSize
                });
            } else {
                // Keep it because removing it would create too large a gap
                clipsToKeep.push(clip);
            }
        } else {
            // Not redundant enough, keep it
            clipsToKeep.push(clip);
        }
    }
    
    const endTime = performance.now();
    const elapsedMs = (endTime - startTime).toFixed(2);
    
    console.log(`Redundancy filtering complete in ${elapsedMs}ms: ${clips.length} → ${clipsToKeep.length} clips (${clipsRemoved.length} removed)`);
    
    return clipsToKeep;
}

// Download clips in parallel with rate limiting
async function downloadClips(clips, broadcasterId, editorId, clientId, oauthToken, progressCallback) {
    if (clips.length === 0) {
        console.log('No clips to download');
        return { successful: 0, failed: 0 };
    }
    
    console.log(`Starting parallel download of ${clips.length} clips...`);
    
    let successful = 0;
    let failed = 0;
    const failedClips = [];
    
    // Get download URLs for all clips first
    const CHUNK_SIZE = 10;
    const allDownloadUrls = [];
    const totalChunks = Math.ceil(clips.length / CHUNK_SIZE);
    
    console.log('Fetching download URLs...');
    for (let i = 0; i < clips.length; i += CHUNK_SIZE) {
        const chunk = clips.slice(i, Math.min(i + CHUNK_SIZE, clips.length));
        const chunkNumber = Math.floor(i / CHUNK_SIZE) + 1;
        const urlsCollected = allDownloadUrls.length;
        
        console.log(`  Getting URLs for chunk ${chunkNumber}/${totalChunks} (${chunk.length} clips)...`);
        
        // Send progress update to popup
        if (progressCallback) {
            progressCallback(`Getting URLs (${urlsCollected}/${clips.length})`);
        }
        
        try {
            const downloadUrls = await getClipDownloadUrls(chunk, broadcasterId, editorId, clientId, oauthToken);
            allDownloadUrls.push(...downloadUrls);
        } catch (error) {
            console.error(`Error getting URLs for chunk:`, error);
            // Mark these clips as failed
            chunk.forEach(clip => {
                failed++;
                failedClips.push(clip.id);
            });
        }
    }
    
    // Final URL collection update
    if (progressCallback) {
        progressCallback(`Downloading ${allDownloadUrls.length} clips...`);
    }
    
    console.log(`\nStarting parallel downloads for ${allDownloadUrls.length} clips...`);
    
    // Download all clips in parallel
    const downloadPromises = allDownloadUrls.map(async (urlData) => {
        const clipInfo = clips.find(c => c.id === urlData.clip_id);
        if (!clipInfo) {
            console.error(`  ✗ Clip info not found for: ${urlData.clip_id}`);
            return { success: false, clipId: urlData.clip_id };
        }
        
        try {
            await downloadClip(urlData, clipInfo);
            console.log(`  ✓ Downloaded: ${clipInfo.title} (${urlData.clip_id})`);
            return { success: true, clipId: urlData.clip_id };
        } catch (error) {
            console.error(`  ✗ Failed to download: ${clipInfo.title} (${urlData.clip_id})`, error.message);
            return { success: false, clipId: urlData.clip_id };
        }
    });
    
    // Wait for all downloads to complete
    const results = await Promise.all(downloadPromises);
    
    // Count successes and failures
    results.forEach(result => {
        if (result.success) {
            successful++;
        } else {
            failed++;
            if (!failedClips.includes(result.clipId)) {
                failedClips.push(result.clipId);
            }
        }
    });
    
    console.log('='.repeat(50));
    console.log(`Download complete!`);
    console.log(`Successful: ${successful}/${clips.length}`);
    console.log(`Failed: ${failed}/${clips.length}`);
    if (failedClips.length > 0) {
        console.log(`Failed clip IDs:`, failedClips);
    }
    console.log('='.repeat(50));
    
    return { successful, failed, failedClips };
}

// Get download URLs for a batch of clips
async function getClipDownloadUrls(clips, broadcasterId, editorId, clientId, oauthToken) {
    return await retryWithBackoff(async () => {
        // Build URL with clip_id parameters
        const clipIdsParam = clips.map(c => `clip_id=${c.id}`).join('&');
        const url = `https://api.twitch.tv/helix/clips/downloads?broadcaster_id=${broadcasterId}&editor_id=${editorId}&${clipIdsParam}`;
        
        console.log(`Requesting download URLs for ${clips.length} clips...`);
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${oauthToken}`,
                'Client-Id': clientId
            }
        });

        if (response.status === 401) {
            notifyAuthExpired();
            throw new Error('Unauthorized: OAuth token expired or invalid. Generate a new token at https://twitchapps.com/tokengen/');
        }
        if (!response.ok) {
            const errorBody = await response.text();
            console.error(`API Error Response:`, errorBody);
            throw new Error(`HTTP error getting download URLs! status: ${response.status} - ${errorBody}`);
        }
        
        const data = await response.json();
        return data.data || [];
    });
}

// Download a single clip
async function downloadClip(urlData, clipInfo) {
    const downloadUrl = urlData.landscape_download_url || urlData.portrait_download_url;
    
    if (!downloadUrl) {
        throw new Error('No download URL available');
    }
    
    // Sanitize filename - prevent path traversal and invalid characters
    const sanitizedTitle = clipInfo.title.replace(/[<>:"/\\|?*]/g, '_');
    const sanitizedCreator = clipInfo.creator_name.replace(/[<>:"/\\|?*\.]/g, '_');
    const sanitizedId = clipInfo.id.replace(/[^a-zA-Z0-9_-]/g, '_');
    const filename = `${clipInfo.created_at.split('T')[0]}_${sanitizedTitle}_${sanitizedCreator}_${sanitizedId}.mp4`;
    
    // Use Chrome downloads API
    return new Promise((resolve, reject) => {
        chrome.downloads.download({
            url: downloadUrl,
            filename: `Twitch_Clips/${filename}`,
            conflictAction: 'overwrite',
            saveAs: false
        }, (downloadId) => {
            if (chrome.runtime.lastError) {
                reject(new Error(chrome.runtime.lastError.message));
            } else {
                // Monitor download completion
                const listener = (delta) => {
                    if (delta.id === downloadId && delta.state) {
                        if (delta.state.current === 'complete') {
                            chrome.downloads.onChanged.removeListener(listener);
                            resolve(downloadId);
                        } else if (delta.state.current === 'interrupted') {
                            chrome.downloads.onChanged.removeListener(listener);
                            reject(new Error('Download interrupted'));
                        }
                    }
                };
                chrome.downloads.onChanged.addListener(listener);
            }
        });
    });
}

// Notify user about expired/invalid OAuth token
function notifyAuthExpired() {
    chrome.runtime.sendMessage({
        action: 'authExpired',
        message: 'Your Twitch OAuth token is invalid or expired. Please generate a new one at https://twitchapps.com/tokengen/'
    }).catch(() => {
        // Ignore errors if popup is closed
    });
}

// Fetch a single page of clips
async function fetchClipsPage(broadcasterId, userId, oauthToken, startDate, endDate, cursor = null) {
    return await retryWithBackoff(async () => {
        // Build URL with query parameters
        let url = `https://api.twitch.tv/helix/clips?broadcaster_id=${broadcasterId}&first=100`;
        
        if (startDate) {
            url += `&started_at=${startDate}`;
        }
        if (endDate) {
            url += `&ended_at=${endDate}`;
        }
        if (cursor) {
            url += `&after=${cursor}`;
        }
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${oauthToken}`,
                'Client-Id': userId
            }
        });

        if (response.status === 401) {
            notifyAuthExpired();
            throw new Error('Unauthorized: OAuth token expired or invalid. Generate a new token at https://twitchapps.com/tokengen/');
        }
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        return {
            clips: data.data || [],
            cursor: data.pagination?.cursor || null
        };
    });
}