// Get references to DOM elements
const keyEntryScreen = document.getElementById('keyEntryScreen');
const mainInterface = document.getElementById('mainInterface');
const decryptionKeyInput = document.getElementById('decryptionKey');
const unlockButton = document.getElementById('unlockButton');
const deleteDataButton = document.getElementById('deleteDataButton');
const keyStatusMessage = document.getElementById('keyStatusMessage');

const appIdInput = document.getElementById('appId');
const oauthTokenInput = document.getElementById('oauthToken');
const channelIdInput = document.getElementById('channelId');
const editorIdInput = document.getElementById('editorId');
const accountListInput = document.getElementById('accountList');
const listModeToggle = document.getElementById('listModeToggle');
const listModeText = document.getElementById('listModeText');
const startDateInput = document.getElementById('startDate');
const endDateInput = document.getElementById('endDate');
const button1 = document.getElementById('button1');
const button2 = document.getElementById('button2');
const scanDurationInput = document.getElementById('scanDuration');
const scanDurationLabel = document.getElementById('scanDurationLabel');
const statusMessage = document.getElementById('statusMessage');
const sizeEstimate = document.getElementById('sizeEstimate');

// Collapsible sections
const credentialsToggle = document.getElementById('credentialsToggle');
const credentialsContent = document.getElementById('credentialsContent');
const filteringToggle = document.getElementById('filteringToggle');
const filteringContent = document.getElementById('filteringContent');

// Filtering options
const maxGapInput = document.getElementById('maxGap');
const coverageThresholdInput = document.getElementById('coverageThreshold');
const maxGapWarning = document.getElementById('maxGapWarning');
const coverageWarning = document.getElementById('coverageWarning');

// Store decryption key in memory only (never saved)
let userDecryptionKey = null;

// Track delete button state
let deleteConfirmationPending = false;

// Track failed unlock attempts for exponential backoff
let failedAttempts = 0;
let lockoutUntil = null;

// Listen for progress updates from background script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === 'downloadProgress') {
        button1.textContent = request.message;
    }
});

// Function to show status message (key entry screen)
function showKeyStatus(message, type = 'info') {
    keyStatusMessage.textContent = message;
    keyStatusMessage.className = `status-message ${type}`;
}

// Function to show status message (main interface)
function showStatus(message, type = 'info') {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;
}

// Function to clear status message
function clearStatus() {
    statusMessage.textContent = '';
    statusMessage.className = 'status-message';
}

// Function to calculate and display estimated download size
function displaySizeEstimate(totalDurationSeconds, totalClips, filteredCount) {
    if (!totalDurationSeconds || totalDurationSeconds <= 0) {
        sizeEstimate.style.display = 'none';
        return;
    }
    
    const BYTES_PER_SECOND = 698665.19;
    const totalBytes = totalDurationSeconds * BYTES_PER_SECOND;
    const totalMB = totalBytes / (1024 * 1024);
    
    // Round to 1 decimal place
    const totalMBRounded = Math.round(totalMB * 10) / 10;
    
    // Convert duration to human-readable format
    const minutes = Math.floor(totalDurationSeconds / 60);
    const seconds = Math.round(totalDurationSeconds % 60);
    const durationStr = minutes > 0 ? `${minutes}m ${seconds}s` : `${seconds}s`;
    
    // Build clip count message
    let clipMsg = `${totalClips} clips`;
    if (filteredCount > 0) {
        clipMsg += `, ${filteredCount} removed by filters`;
    }
    
    sizeEstimate.innerHTML = `
        <div><span class="size-value">${totalMBRounded} MB</span></div>
        <div style="font-size: 12px; margin-top: 5px;">${clipMsg} • ${durationStr} total duration</div>
    `;
    sizeEstimate.style.display = 'block';
}

// Function to hide size estimate
function hideSizeEstimate() {
    sizeEstimate.style.display = 'none';
}

// Collapsible section handlers
credentialsToggle.addEventListener('click', () => {
    credentialsToggle.classList.toggle('active');
    credentialsContent.classList.toggle('open');
});

filteringToggle.addEventListener('click', () => {
    filteringToggle.classList.toggle('active');
    filteringContent.classList.toggle('open');
});

// Filtering validation handlers
maxGapInput.addEventListener('input', () => {
    const value = parseInt(maxGapInput.value) || 0;
    if (value > 5) {
        maxGapWarning.style.display = 'block';
    } else {
        maxGapWarning.style.display = 'none';
    }
});

coverageThresholdInput.addEventListener('input', () => {
    const value = parseInt(coverageThresholdInput.value) || 95;
    if (value < 80) {
        coverageWarning.style.display = 'block';
    } else {
        coverageWarning.style.display = 'none';
    }
});

// Scan duration slider handler
scanDurationInput.addEventListener('input', () => {
    scanDurationLabel.textContent = scanDurationInput.value + 's';
});

// List mode toggle handler
listModeToggle.addEventListener('change', () => {
    const isWhitelist = listModeToggle.checked;
    listModeText.textContent = isWhitelist ? 'Whitelist' : 'Blacklist';
    
    // Save the setting
    if (userDecryptionKey) {
        chrome.storage.local.set({ listMode: isWhitelist ? 'whitelist' : 'blacklist' });
    }
});

// Cache salt in memory to avoid repeated storage lookups
let cachedSalt = null;

// Generate or retrieve salt for key derivation
async function getSalt() {
    // Return cached salt if available
    if (cachedSalt) {
        return cachedSalt;
    }
    
    const result = await chrome.storage.local.get(['encryptionSalt']);
    
    if (result.encryptionSalt) {
        // Return existing salt and cache it
        cachedSalt = new Uint8Array(atob(result.encryptionSalt).split('').map(c => c.charCodeAt(0)));
        return cachedSalt;
    } else {
        // Generate new random salt
        const salt = crypto.getRandomValues(new Uint8Array(16));
        // Store salt (salts don't need to be secret)
        await chrome.storage.local.set({ encryptionSalt: btoa(String.fromCharCode(...salt)) });
        cachedSalt = salt;
        return salt;
    }
}

// Encryption/Decryption utilities - now uses user-provided key with random salt
async function getEncryptionKey(userKey) {
    const encoder = new TextEncoder();
    const keyMaterial = await crypto.subtle.importKey(
        'raw',
        encoder.encode(userKey),
        { name: 'PBKDF2' },
        false,
        ['deriveBits', 'deriveKey']
    );
    
    const salt = await getSalt();
    
    return await crypto.subtle.deriveKey(
        {
            name: 'PBKDF2',
            salt: salt,
            iterations: 600000,
            hash: 'SHA-256'
        },
        keyMaterial,
        { name: 'AES-GCM', length: 256 },
        false,
        ['encrypt', 'decrypt']
    );
}

async function encryptData(data, userKey) {
    if (!data || !userKey) return null;
    
    const encoder = new TextEncoder();
    const key = await getEncryptionKey(userKey);
    const iv = crypto.getRandomValues(new Uint8Array(12));
    
    const encryptedData = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv: iv },
        key,
        encoder.encode(data)
    );
    
    // Combine IV and encrypted data
    const combined = new Uint8Array(iv.length + encryptedData.byteLength);
    combined.set(iv, 0);
    combined.set(new Uint8Array(encryptedData), iv.length);
    
    // Convert to base64 for storage
    return btoa(String.fromCharCode(...combined));
}

async function decryptData(encryptedBase64, userKey) {
    if (!encryptedBase64 || !userKey) return null;
    
    try {
        const decoder = new TextDecoder();
        const key = await getEncryptionKey(userKey);
        
        // Convert from base64
        const combined = new Uint8Array(
            atob(encryptedBase64).split('').map(c => c.charCodeAt(0))
        );
        
        // Extract IV and encrypted data
        const iv = combined.slice(0, 12);
        const encryptedData = combined.slice(12);
        
        const decryptedData = await crypto.subtle.decrypt(
            { name: 'AES-GCM', iv: iv },
            key,
            encryptedData
        );
        
        return decoder.decode(decryptedData);
    } catch (error) {
        console.error('Decryption failed:', error);
        return null;
    }
}

// Check if any saved data exists
async function hasSavedData() {
    const result = await chrome.storage.local.get(['appId', 'oauthToken', 'channelId', 'editorId', 'accountList', 'startDate', 'endDate']);
    return Object.keys(result).length > 0 && Object.values(result).some(val => val);
}

// Check if this is first-time setup (no encrypted credentials exist)
async function isFirstTimeSetup() {
    const result = await chrome.storage.local.get(['appId', 'oauthToken', 'firstTimeSetupComplete']);
    return !result.firstTimeSetupComplete || (!result.appId && !result.oauthToken);
}

// Validate decryption key by attempting to decrypt saved data
async function validateDecryptionKey(key, confirmKey = null) {
    if (!key) return { valid: false, error: 'Key is required' };
    
    // Check for minimum key length
    if (key.length < 12) {
        return { valid: false, error: 'Key must be at least 12 characters long' };
    }
    
    const firstTime = await isFirstTimeSetup();
    
    // First-time setup: require confirmation
    if (firstTime) {
        if (confirmKey === null) {
            return { valid: false, error: 'Confirmation required', needsConfirmation: true };
        }
        if (key !== confirmKey) {
            return { valid: false, error: 'Keys do not match' };
        }
        // Mark first-time setup as complete
        await chrome.storage.local.set({ firstTimeSetupComplete: true });
        return { valid: true, firstTime: true };
    }
    
    // Get saved encrypted data
    const result = await chrome.storage.local.get(['appId', 'oauthToken']);
    
    // Try to decrypt at least one piece of data
    if (result.appId) {
        const decrypted = await decryptData(result.appId, key);
        return { valid: decrypted !== null };
    }
    
    if (result.oauthToken) {
        const decrypted = await decryptData(result.oauthToken, key);
        return { valid: decrypted !== null };
    }
    
    return { valid: false, error: 'No encrypted data found' };
}

// Load and populate main interface
async function loadMainInterface() {
    try {
        const result = await chrome.storage.local.get([
            'appId', 'oauthToken', 'channelId', 'editorId', 
            'accountList', 'listMode', 'startDate', 'endDate',
            'maxGap', 'coverageThreshold', 'scanDuration'
        ]);
        
        // Decrypt App ID
        if (result.appId) {
            const decrypted = await decryptData(result.appId, userDecryptionKey);
            if (decrypted) appIdInput.value = decrypted;
        }
        
        // Decrypt Oauth Token
        if (result.oauthToken) {
            const decrypted = await decryptData(result.oauthToken, userDecryptionKey);
            if (decrypted) oauthTokenInput.value = decrypted;
        }
        
        // Decrypt all other fields (now encrypted)
        if (result.channelId) {
            const decrypted = await decryptData(result.channelId, userDecryptionKey);
            if (decrypted) channelIdInput.value = decrypted;
        }
        if (result.editorId) {
            const decrypted = await decryptData(result.editorId, userDecryptionKey);
            if (decrypted) editorIdInput.value = decrypted;
        }
        if (result.accountList) {
            const decrypted = await decryptData(result.accountList, userDecryptionKey);
            if (decrypted) accountListInput.value = decrypted;
        }
        if (result.listMode) {
            const isWhitelist = result.listMode === 'whitelist';
            listModeToggle.checked = isWhitelist;
            listModeText.textContent = isWhitelist ? 'Whitelist' : 'Blacklist';
        }
        if (result.startDate) {
            const decrypted = await decryptData(result.startDate, userDecryptionKey);
            if (decrypted) startDateInput.value = decrypted;
        }
        if (result.endDate) {
            const decrypted = await decryptData(result.endDate, userDecryptionKey);
            if (decrypted) endDateInput.value = decrypted;
        }
        
        // Load filtering options (not encrypted, just stored values)
        if (result.maxGap !== undefined) {
            maxGapInput.value = result.maxGap;
            // Trigger validation warning check
            if (result.maxGap > 5) {
                maxGapWarning.style.display = 'block';
            }
        } else {
            maxGapInput.value = 0; // Default to 0
        }
        
        if (result.coverageThreshold !== undefined) {
            coverageThresholdInput.value = result.coverageThreshold;
            // Trigger validation warning check
            if (result.coverageThreshold < 80) {
                coverageWarning.style.display = 'block';
            }
        } else {
            coverageThresholdInput.value = 95; // Default to 95%
        }
        
        // Load scan duration (not encrypted)
        if (result.scanDuration !== undefined) {
            scanDurationInput.value = result.scanDuration;
            scanDurationLabel.textContent = result.scanDuration + 's';
        } else {
            scanDurationInput.value = 10; // Default to 10 seconds
            scanDurationLabel.textContent = '10s';
        }
    } catch (error) {
        console.error('Failed to load and decrypt data:', error);
        showKeyStatus('Failed to decrypt saved data. The decryption key may be incorrect.', 'error');
        // Return to key entry screen
        mainInterface.style.display = 'none';
        keyEntryScreen.style.display = 'block';
        userDecryptionKey = null;
    }
}

// Unlock button handler with exponential backoff
unlockButton.addEventListener('click', async () => {
    // Check if currently locked out
    if (lockoutUntil && Date.now() < lockoutUntil) {
        const remainingSeconds = Math.ceil((lockoutUntil - Date.now()) / 1000);
        showKeyStatus(`Too many failed attempts. Wait ${remainingSeconds} seconds.`, 'error');
        return;
    }
    
    const key = decryptionKeyInput.value.trim();
    const confirmKeyField = document.getElementById('confirmDecryptionKey');
    const confirmKey = confirmKeyField ? confirmKeyField.value.trim() : null;
    
    if (!key) {
        showKeyStatus('Please enter a decryption key', 'error');
        return;
    }
    
    unlockButton.disabled = true;
    unlockButton.textContent = 'Validating...';
    showKeyStatus('Validating key...', 'info');
    
    const result = await validateDecryptionKey(key, confirmKey);
    
    if (result.needsConfirmation && !confirmKeyField) {
        // First-time setup: show confirmation field
        unlockButton.disabled = false;
        unlockButton.textContent = 'Unlock';
        
        const confirmGroup = document.createElement('div');
        confirmGroup.className = 'input-group';
        confirmGroup.innerHTML = `
            <label for="confirmDecryptionKey">Confirm Decryption Key:</label>
            <div class="input-with-toggle">
                <input type="password" id="confirmDecryptionKey" placeholder="Re-enter your decryption key">
                <button type="button" class="toggle-visibility" data-target="confirmDecryptionKey">👁️</button>
            </div>
        `;
        
        decryptionKeyInput.parentElement.parentElement.after(confirmGroup);
        
        // Add toggle functionality to new button
        const newToggle = confirmGroup.querySelector('.toggle-visibility');
        newToggle.addEventListener('click', () => {
            const target = document.getElementById('confirmDecryptionKey');
            if (target.type === 'password') {
                target.type = 'text';
                newToggle.textContent = '🙈';
            } else {
                target.type = 'password';
                newToggle.textContent = '👁️';
            }
        });
        
        showKeyStatus('Please confirm your key. Minimum 12 characters required.', 'info');
        return;
    }
    
    if (result.valid) {
        userDecryptionKey = key;
        failedAttempts = 0; // Reset failed attempts
        lockoutUntil = null;
        showKeyStatus('Key accepted!', 'success');
        
        // Small delay for UX
        setTimeout(async () => {
            keyEntryScreen.style.display = 'none';
            mainInterface.style.display = 'block';
            await loadMainInterface();
        }, 500);
    } else {
        // Failed attempt - implement exponential backoff
        failedAttempts++;
        
        if (failedAttempts >= 3) {
            // Exponential backoff: 2^(attempts-2) seconds
            const lockoutSeconds = Math.pow(2, failedAttempts - 2);
            lockoutUntil = Date.now() + (lockoutSeconds * 1000);
            showKeyStatus(`Too many failed attempts. Locked out for ${lockoutSeconds} seconds.`, 'error');
        } else {
            showKeyStatus(result.error || 'Incorrect decryption key', 'error');
        }
        
        unlockButton.disabled = false;
        unlockButton.textContent = 'Unlock';
    }
});

// Allow Enter key to submit
decryptionKeyInput.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') {
        unlockButton.click();
    }
});

// Delete data button handler with two-step confirmation
deleteDataButton.addEventListener('click', async () => {
    if (!deleteConfirmationPending) {
        // First click - ask for confirmation
        deleteConfirmationPending = true;
        deleteDataButton.textContent = 'Are you sure?';
        deleteDataButton.style.backgroundColor = '#bd2130';
        
        // Reset after 3 seconds if not confirmed
        setTimeout(() => {
            if (deleteConfirmationPending) {
                deleteConfirmationPending = false;
                deleteDataButton.textContent = 'Delete Data';
                deleteDataButton.style.backgroundColor = '';
            }
        }, 3000);
    } else {
        // Second click - actually delete data
        deleteDataButton.disabled = true;
        deleteDataButton.textContent = 'Deleting...';
        
        try {
            await chrome.storage.local.clear();
            
            // Clear cached salt
            cachedSalt = null;
            
            showKeyStatus('All data deleted. You can now use a new key.', 'success');
            
            // Reset failed attempts and lockout
            failedAttempts = 0;
            lockoutUntil = null;
            
            // Hide delete button and reset
            deleteDataButton.style.display = 'none';
            deleteConfirmationPending = false;
            deleteDataButton.disabled = false;
            deleteDataButton.textContent = 'Delete Data';
            deleteDataButton.style.backgroundColor = '';
            
            // Clear input fields
            decryptionKeyInput.value = '';
            const confirmField = document.getElementById('confirmDecryptionKey');
            if (confirmField) {
                confirmField.parentElement.parentElement.remove();
            }
        } catch (error) {
            showKeyStatus('Error deleting data: ' + error.message, 'error');
            deleteDataButton.disabled = false;
            deleteDataButton.textContent = 'Delete Data';
            deleteConfirmationPending = false;
        }
    }
});

// Check if delete button should be shown on load
(async function checkDeleteButton() {
    const hasData = await hasSavedData();
    if (hasData) {
        deleteDataButton.style.display = 'block';
    }
})();

// Toggle visibility buttons
const toggleButtons = document.querySelectorAll('.toggle-visibility');
toggleButtons.forEach(button => {
    button.addEventListener('click', () => {
        const targetId = button.getAttribute('data-target');
        const targetInput = document.getElementById(targetId);
        
        if (targetInput.type === 'password') {
            targetInput.type = 'text';
            button.textContent = '🙈';
        } else {
            targetInput.type = 'password';
            button.textContent = '👁️';
        }
    });
});

// Function to convert datetime-local to RFC3339 format with UTC time adjustment
function toRFC3339(dateTimeLocal, isEndDate = false) {
    if (!dateTimeLocal) return null;
    
    // datetime-local format: YYYY-MM-DDTHH:mm
    // Extract just the date part (YYYY-MM-DD)
    const datePart = dateTimeLocal.split('T')[0];
    
    // Create UTC date with appropriate time
    if (isEndDate) {
        // End date: 23:59:59.999 UTC
        return `${datePart}T23:59:59.999Z`;
    } else {
        // Start date: 00:00:00.000 UTC
        return `${datePart}T00:00:00.000Z`;
    }
}

// Function to validate date inputs
function validateDates(startDateTime, endDateTime) {
    if (!startDateTime || !endDateTime) {
        return { valid: false, error: 'Please select both start and end dates.' };
    }
    
    const startDate = new Date(startDateTime);
    const endDate = new Date(endDateTime);
    const now = new Date();
    
    // Check if dates are valid
    if (isNaN(startDate.getTime()) || isNaN(endDate.getTime())) {
        return { valid: false, error: 'Invalid date format.' };
    }
    
    // Check if start date is after end date
    if (startDate > endDate) {
        return { valid: false, error: 'Start date must be before or equal to end date.' };
    }
    
    // Check if end date is in the future
    if (endDate > now) {
        return { valid: false, error: 'End date cannot be in the future.' };
    }
    
    return { valid: true };
}

// Function to check if channel input is a username (contains letters) or ID (only numbers)
function isChannelUsername(channelInput) {
    return /[a-zA-Z]/.test(channelInput);
}

// Retry utility for network requests with exponential backoff
async function retryWithBackoff(fn, maxRetries = 3, initialDelayMs = 1000) {
    let lastError;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt === maxRetries) {
                throw error;
            }
            
            const delayMs = initialDelayMs * Math.pow(2, attempt - 1);
            console.log(`Retry attempt ${attempt} failed, retrying in ${delayMs}ms...`);
            await new Promise(resolve => setTimeout(resolve, delayMs));
        }
    }
    throw lastError;
}

// Function to convert username to user ID using Twitch API
async function getUserIdFromUsername(username, appId, oauthToken) {
    return await retryWithBackoff(async () => {
        const url = `https://api.twitch.tv/helix/users?login=${username.toLowerCase()}`;
        
        const response = await fetch(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${oauthToken}`,
                'Client-Id': appId
            }
        });
        
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const data = await response.json();
        
        if (data.data && data.data.length > 0) {
            return data.data[0].id;
        } else {
            throw new Error('User not found');
        }
    });
}

// Button 1 click handler - Filter and download
button1.addEventListener('click', async () => {
    const appId = appIdInput.value;
    const oauthToken = oauthTokenInput.value;
    let channelId = channelIdInput.value.trim();
    const editorId = editorIdInput.value || channelId; // Default to channelId if not specified
    const accountListRaw = accountListInput.value;
    const listMode = listModeToggle.checked ? 'whitelist' : 'blacklist';
    const startDateTime = startDateInput.value;
    const endDateTime = endDateInput.value;
    
    // Validate dates first
    const dateValidation = validateDates(startDateTime, endDateTime);
    if (!dateValidation.valid) {
        showStatus(dateValidation.error, 'error');
        return;
    }
    
    const rfc3339StartDate = toRFC3339(startDateTime, false); // 00:00 UTC
    const rfc3339EndDate = toRFC3339(endDateTime, true);       // 23:59 UTC
    
    // Parse account list (comma-separated, trim whitespace)
    const accountList = accountListRaw
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0);
    
    clearStatus();
    button1.disabled = true;
    button1.textContent = 'Processing...';
    
    // Check if channelId is a username and convert to ID if needed
    if (isChannelUsername(channelId)) {
        button1.textContent = 'Converting username...';
        try {
            const resolvedId = await getUserIdFromUsername(channelId, appId, oauthToken);
            channelId = resolvedId;
            button1.textContent = 'Processing...';
        } catch (error) {
            showStatus(`Error converting username to ID: ${error.message}`, 'error');
            button1.disabled = false;
            button1.textContent = 'Download Range';
            return;
        }
    }
    
    // Send message to background script with decrypted values
    chrome.runtime.sendMessage({
        action: 'button1Action',
        data: {
            userId: appId,
            oauthToken: oauthToken,
            channelId: channelId,
            editorId: editorId,
            accountList: accountList,
            listMode: listMode,
            startDate: rfc3339StartDate,
            endDate: rfc3339EndDate,
            maxGap: parseInt(maxGapInput.value) || 0,
            coverageThreshold: (parseInt(coverageThresholdInput.value) || 95) / 100
        }
    }, (response) => {
        button1.disabled = false;
        button1.textContent = 'Download Range';
        
        if (response.success) {
            const filtered = response.originalCount - response.count;
            displaySizeEstimate(response.totalDuration, response.originalCount, filtered);
            showStatus(`Downloaded ${response.downloaded}/${response.count} clips successfully (${response.failed} failed)`, response.failed > 0 ? 'error' : 'success');
        } else {
            hideSizeEstimate();
            showStatus(`Error: ${response.error}`, 'error');
        }
    });
});

// Button 2 click handler - Discover clips
button2.addEventListener('click', async () => {
    const appId = appIdInput.value;
    const oauthToken = oauthTokenInput.value;
    let channelId = channelIdInput.value.trim();
    const accountListRaw = accountListInput.value;
    const listMode = listModeToggle.checked ? 'whitelist' : 'blacklist';
    const startDateTime = startDateInput.value;
    const endDateTime = endDateInput.value;
    
    // Validate dates first
    const dateValidation = validateDates(startDateTime, endDateTime);
    if (!dateValidation.valid) {
        showStatus(dateValidation.error, 'error');
        return;
    }
    
    const rfc3339StartDate = toRFC3339(startDateTime, false); // 00:00 UTC
    const rfc3339EndDate = toRFC3339(endDateTime, true);       // 23:59 UTC
    
    // Parse account list (comma-separated, trim whitespace)
    const accountList = accountListRaw
        .split(',')
        .map(name => name.trim())
        .filter(name => name.length > 0);
    
    // Clear previous status and disable button
    clearStatus();
    button2.disabled = true;
    button2.textContent = 'Scanning...';
    
    // Check if channelId is a username and convert to ID if needed
    if (isChannelUsername(channelId)) {
        button2.textContent = 'Converting username...';
        try {
            const resolvedId = await getUserIdFromUsername(channelId, appId, oauthToken);
            channelId = resolvedId;
            button2.textContent = 'Scanning...';
        } catch (error) {
            showStatus(`Error converting username to ID: ${error.message}`, 'error');
            button2.disabled = false;
            button2.textContent = 'Scan Range';
            button2.style.background = '';
            return;
        }
    }
    
    // Start progress bar animation (assume 10 seconds, will be corrected by response)
    button2.style.position = 'relative';
    button2.style.overflow = 'hidden';
    const scanStartTime = Date.now();
    const scanDuration = parseInt(scanDurationInput.value) || 10; // Get duration from input
    const estimatedDuration = scanDuration * 1000; // Convert to milliseconds
    
    const progressInterval = setInterval(() => {
        const elapsed = Date.now() - scanStartTime;
        const progress = Math.min((elapsed / estimatedDuration) * 100, 100);
        button2.style.background = `linear-gradient(to right, #5a6268 ${progress}%, #6c757d ${progress}%)`;
    }, 50); // Update every 50ms for smooth animation
    
    // Send message to background script with decrypted values
    chrome.runtime.sendMessage({
        action: 'button2Action',
        data: {
            userId: appId,
            oauthToken: oauthToken,
            channelId: channelId,
            accountList: accountList,
            listMode: listMode,
            startDate: rfc3339StartDate,
            endDate: rfc3339EndDate,
            maxGap: parseInt(maxGapInput.value) || 0,
            coverageThreshold: (parseInt(coverageThresholdInput.value) || 95) / 100,
            scanDuration: scanDuration
        }
    }, (response) => {
        // Stop progress bar animation
        clearInterval(progressInterval);
        
        // Re-enable button and reset styling
        button2.disabled = false;
        button2.textContent = 'Scan Range';
        button2.style.background = '';
        button2.style.position = '';
        button2.style.overflow = '';
        
        if (response.success) {
            const totalFiltered = response.originalCount - response.count;
            displaySizeEstimate(response.totalDuration, response.originalCount, totalFiltered);
            
            // Show warning if partial filtering was applied
            if (response.partialFilteringApplied && response.nullOffsetCount > 0) {
                showStatus(`⚠️ Warning: ${response.nullOffsetCount} clip${response.nullOffsetCount > 1 ? 's' : ''} missing timeline data - kept without filtering`, 'info');
            } else {
                clearStatus();
            }
        } else {
            hideSizeEstimate();
            showStatus(`Error: ${response.error}`, 'error');
        }
    });
});

// Save all input fields to storage when they change (encrypted)
const inputFieldsToSave = {
    'appId': appIdInput,
    'oauthToken': oauthTokenInput,
    'channelId': channelIdInput,
    'editorId': editorIdInput,
    'accountList': accountListInput,
    'startDate': startDateInput,
    'endDate': endDateInput
};

Object.keys(inputFieldsToSave).forEach(key => {
    inputFieldsToSave[key].addEventListener('change', async () => {
        if (!userDecryptionKey) return;
        try {
            const encrypted = await encryptData(inputFieldsToSave[key].value, userDecryptionKey);
            chrome.storage.local.set({ [key]: encrypted });
        } catch (error) {
            console.error(`Failed to encrypt and save ${key}:`, error);
            showStatus(`Failed to save ${key}. Please try again.`, 'error');
        }
    });
});

// Save filtering options (not encrypted, just stored values)
maxGapInput.addEventListener('change', async () => {
    const value = parseInt(maxGapInput.value) || 0;
    await chrome.storage.local.set({ maxGap: value });
});

coverageThresholdInput.addEventListener('change', async () => {
    const value = parseInt(coverageThresholdInput.value) || 95;
    await chrome.storage.local.set({ coverageThreshold: value });
});

// Save scan duration (not encrypted, just stored value)
scanDurationInput.addEventListener('change', async () => {
    const value = parseInt(scanDurationInput.value) || 10;
    await chrome.storage.local.set({ scanDuration: value });
});
