import { callPopup, eventSource, event_types, getRequestHeaders, saveSettingsDebounced, chat_metadata, name2, systemUserName, neutralCharacterName } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import { executeSlashCommands, registerSlashCommand } from '../../../slash-commands.js';
import { delay, navigation_option } from '../../../utils.js';
import { createWorldInfoEntry, deleteWIOriginalDataValue, deleteWorldInfoEntry, importWorldInfo, loadWorldInfo, saveWorldInfo, world_info, getWorldInfoSettings, setWorldInfoSettings } from '../../../world-info.js';
import { selected_group, groups } from '../../../group-chats.js';

// Constants for magic strings
const POPUP_TYPES = {
    CONFIRM: 'confirm',
    INPUT: 'input',
};

const CSS_CLASSES = {
    TOGGLE_ENABLED: 'toggleEnabled',
    RED_WARNING_BG: 'redWarningBG',
    STWIL_CONTAINER: 'stwil-container',
    STWIL_PRESET: 'stwil-preset',
    STWIL_ACTIONS: 'stwil-actions',
    STWIL_ACTION: 'stwil-action',
    STWIL_IMPORT_FILE: 'stwil-importFile',
    MENU_BUTTON: 'menu_button',
    CHECKBOX_LABEL: 'checkbox_label'
};

// Context cache to avoid redundant character name lookups
let cachedContext = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 100; // Cache valid for 100ms

// ----------------- charLore store helpers -----------------
/**
 * Persisted charLore store key on extension_settings:
 * extension_settings.worldInfoCharLore
 *
 * Behavior:
 * - initCharLoreStore() should be called during init().
 * - storeCharLoreIfExists() will capture any existing charLore from the system and persist it.
 * - getStoredCharLore()/setStoredCharLore() are used by safeSetWorldInfoSettings and other code paths.
 */

function getStoredCharLore() {
    try {
        return extension_settings?.worldInfoCharLore ?? null;
    } catch (e) {
        console.warn('STWIL: getStoredCharLore failed:', e?.message ?? e);
        return null;
    }
}

function setStoredCharLore(value) {
    try {
        if (!extension_settings) return;
        if (value === undefined || value === null) {
            extension_settings.worldInfoCharLore = null;
        } else {
            extension_settings.worldInfoCharLore = value;
        }
        try { saveSettingsDebounced(); } catch (e) { /* ignore if not available */ }
    } catch (e) {
        console.warn('STWIL: setStoredCharLore failed:', e?.message ?? e);
    }
}

/**
 * Read charLore from current system world info and store it if present.
 * Use this at startup and optionally after user edits.
 */
function storeCharLoreIfExists() {
    try {
        const cur = getWorldInfoSettings() || {};
        if (cur.world_info && Object.prototype.hasOwnProperty.call(cur.world_info, 'charLore')) {
            setStoredCharLore(cur.world_info.charLore);
            console.log('STWIL: storeCharLoreIfExists: stored charLore from system');
        } else {
            console.log('STWIL: storeCharLoreIfExists: no charLore found in system');
        }
    } catch (e) {
        console.warn('STWIL: storeCharLoreIfExists failed:', e?.message ?? e);
    }
}

/**
 * Safely apply world info settings while preserving any existing charLore.
 * - If the current world_info object contains a charLore key, that exact value will be retained.
 * - Otherwise, if an extension store has a charLore, it will be restored unless toApply explicitly defines its own charLore.
 */
async function safeSetWorldInfoSettings(toApply) {
    try {
        // Get current system world info
        const current = getWorldInfoSettings() || {};
        const currentHasCharLore = !!(current.world_info && Object.prototype.hasOwnProperty.call(current.world_info, 'charLore'));
        const currentCharLore = currentHasCharLore ? current.world_info.charLore : undefined;

        // Clone toApply to safely modify
        const toSet = JSON.parse(JSON.stringify(toApply || {}));
        toSet.world_info = toSet.world_info || {};

        // 1) If the system currently has charLore, preserve it (do not allow toApply to overwrite it)
        if (currentHasCharLore) {
            toSet.world_info.charLore = currentCharLore;
        } else {
            // 2) If system had no charLore but stored charLore exists, restore it (unless toSet explicitly has its own)
            const stored = getStoredCharLore();
            if (stored !== null && !Object.prototype.hasOwnProperty.call(toSet.world_info, 'charLore')) {
                toSet.world_info.charLore = stored;
                console.log('STWIL: safeSetWorldInfoSettings restored charLore from store');
            }
            // else: leave toSet.world_info.charLore alone (allow presets to set charLore if they explicitly include it)
        }

        // Apply settings
        await setWorldInfoSettings(toSet);

        // After applying, check what actually ended up in system and update the store if user changed charLore
        try {
            const final = getWorldInfoSettings() || {};
            if (final.world_info && Object.prototype.hasOwnProperty.call(final.world_info, 'charLore')) {
                setStoredCharLore(final.world_info.charLore);
            }
        } catch (innerErr) {
            console.warn('STWIL: safeSetWorldInfoSettings post-check failed:', innerErr?.message ?? innerErr);
        }
    } catch (err) {
        console.warn('STWIL: safeSetWorldInfoSettings failed:', err?.message ?? err);
        // Fallback: try direct set to avoid losing functionality if helper errors
        try {
            await setWorldInfoSettings(toApply);
        } catch (ex) {
            console.error('STWIL: fallback setWorldInfoSettings also failed:', ex?.message ?? ex);
        }
    }
}

export class Settings {
    static from(props) {
        props.presetList = props.presetList?.map(it=>Preset.from(it)) ?? [];
        const instance = Object.assign(new this(), props);
        extension_settings.worldInfoPresets = instance;
        return instance;
    }
    /**@type {String}*/ presetName;
    /**@type {Preset[]}*/ presetList = [];
    /**@type {Object.<string, string>}*/ characterLocks = {}; // characterName -> presetName
    /**@type {boolean}*/ preferChatOverCharacterLocks = false;
    /**@type {boolean}*/ enableCharacterLocks = true;
    /**@type {boolean}*/ enableChatLocks = true;
    /**@type {boolean}*/ showLockNotifications = true;
    /**@type {String}*/ globalDefaultPreset = ''; // Global default preset name
    
    get preset() {
        return this.presetList.find(it=>it.name == this.presetName);
    }
}

export class Preset {
    static from(props) {
        const instance = Object.assign(new this(), props);
        return instance;
    }
    /**@type {String}*/ name;
    /**@type {String[]}*/ worldList = [];
    /**@type {Object}*/ worldInfoSettings = {};

    toJSON() {
        return {
            name: this.name,
            worldList: this.worldList,
            worldInfoSettings: this.worldInfoSettings || {},
        };
    }
}

/**@type {Settings}*/
export const settings = Settings.from(extension_settings.worldInfoPresets ?? {});

/**@type {HTMLSelectElement}*/
let presetSelect;
let lockButton;
let settingsButton;

function getCharacterNameForSettings() {
    const isGroupChat = !!selected_group;
    
    if (isGroupChat) {
        // For group chats, use the group name as the character identifier
        const group = groups?.find(x => x.id === selected_group);
        if (group && group.name) {
            const groupName = String(group.name).trim();
            console.log('STWIL: Group chat detected, using group name:', groupName);
            return groupName;
        } else {
            console.warn('STWIL: Group chat detected but no group name available');
            return null;
        }
    }
    
    // Use name2 variable from script.js
    let rawCharacterName = name2;

    // Fallback: Use chat_metadata.character_name if name2 is not available
    if (!rawCharacterName || rawCharacterName === systemUserName || rawCharacterName === neutralCharacterName) {
        rawCharacterName = chat_metadata?.character_name;

        if (!rawCharacterName) {
            console.warn('STWIL: No character name available in name2 or chat_metadata');
            return null;
        }
    }

    let characterName = String(rawCharacterName).trim();

    // Normalize unicode characters to handle special characters consistently
    if (characterName.normalize) {
        characterName = characterName.normalize('NFC');
    }

    return characterName;
}

// Cache helper functions
function clearContextCache() {
    cachedContext = null;
    cacheTimestamp = 0;
}

function isCacheValid() {
    return cachedContext && (Date.now() - cacheTimestamp) < CACHE_DURATION_MS;
}

function getCurrentContext() {
    // Return cached context if still valid
    if (isCacheValid()) {
        return cachedContext;
    }
    
    // Clear cache and recalculate
    clearContextCache();
    const characterName = getCharacterNameForSettings();
    const isGroupChat = !!selected_group;
    let chatId = chat_metadata?.file_name || null;
    let groupId = null;
    let groupName = null;
    
    if (isGroupChat) {
        // For group chats, also get group-specific information
        groupId = selected_group;
        const group = groups?.find(x => x.id === selected_group);
        if (group) {
            groupName = group.name;
            // Use group's chat_id if available, fallback to metadata file_name
            chatId = group.chat_id || chatId;
        }
    }
    
    // Cache the new context
    cachedContext = {
        characterName,
        chatId,
        isGroupChat,
        groupId,
        groupName
    };
    cacheTimestamp = Date.now();
    
    return cachedContext;
}

function getChatLock() {
    return chat_metadata?.worldInfoPresetLock || null;
}

function setChatLock(presetName) {
    if (!chat_metadata) {
        window.chat_metadata = {};
    }
    if (presetName) {
        chat_metadata.worldInfoPresetLock = presetName;
    } else {
        delete chat_metadata.worldInfoPresetLock;
    }
    saveMetadataDebounced();
}

function getCharacterLock(characterName) {
    if (!characterName) return null;
    return settings.characterLocks[characterName] || null;
}

function setCharacterLock(characterName, presetName) {
    if (!characterName) return;
    if (presetName) {
        settings.characterLocks[characterName] = presetName;
    } else {
        delete settings.characterLocks[characterName];
    }
    saveSettingsDebounced();
}

function getLockForContext() {
    const context = getCurrentContext();
    const chatLock = settings.enableChatLocks ? getChatLock() : null;
    const characterLock = settings.enableCharacterLocks ? getCharacterLock(context.characterName) : null;
    
    if (settings.preferChatOverCharacterLocks) {
        return chatLock || characterLock;
    } else {
        return characterLock || chatLock;
    }
}

function hasAnyLocks() {
    const context = getCurrentContext();
    const chatLock = settings.enableChatLocks ? getChatLock() : null;
    const characterLock = settings.enableCharacterLocks ? getCharacterLock(context.characterName) : null;
    return !!(chatLock || characterLock);
}

async function checkAndApplyLocks() {
    let attempts = 0;
    const maxAttempts = 10;
    
    while (attempts < maxAttempts) {
        const lockedPreset = getLockForContext();
        
        if (lockedPreset) {
            const preset = settings.presetList.find(p => p.name === lockedPreset);
            if (preset) {
                await activatePreset(preset);
                if (settings.showLockNotifications) {
                    const context = getCurrentContext();
                    const lockType = getChatLock() ? 'chat' : 'character';
                    toastr.info(`Applied locked preset "${lockedPreset}" for ${lockType}`, 'World Info Presets');
                }
                return; // Success
            } else if (settings.showLockNotifications) {
                toastr.warning(`Locked preset "${lockedPreset}" not found`, 'World Info Presets');
                return; // Preset not found, don't retry
            }
        }
        
        // If we reach here, either no lock or character data not ready
        const context = getCurrentContext();
        
        if (!context.characterName && !context.chatId) {
            // Wait a bit for data to load
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
            continue;
        }
        
        // Data is available but no locks - apply global default for unlocked characters
        if (settings.globalDefaultPreset) {
            const defaultPreset = settings.presetList.find(p => p.name === settings.globalDefaultPreset);
            
            if (defaultPreset) {
                await activatePreset(defaultPreset);
                if (settings.showLockNotifications) {
                    toastr.info(`Applied global default preset "${settings.globalDefaultPreset}" for unlocked character`, 'World Info Presets');
                }
                return;
            }
        }
        
        break;
    }
    
    if (attempts >= maxAttempts) {
        console.warn('STWIL: Timed out waiting for character/chat data to load for lock check');
    }
}

const activatePresetByName = async(name)=>{
    const preset = settings.presetList.find(it=>it.name.toLowerCase() == name.toLowerCase());
    if (!preset) {
        toastr.warning(`Preset "${name}" not found`);
        return;
    }
    await activatePreset(preset);
};

export const activatePreset = async(preset, skipLockCheck = false)=>{
    // Check if we're changing presets in a locked context
    if (!skipLockCheck && hasAnyLocks()) {
        const currentLock = getLockForContext();
        if (currentLock && preset?.name !== currentLock) {
            const shouldUpdate = await callPopup(
                `<h3>Preset Lock Active</h3>
                <p>This context is locked to preset "${currentLock}" but you're switching to "${preset?.name || 'None'}".</p>
                <p>Do you want to update the lock to use the new preset?</p>`,
                POPUP_TYPES.CONFIRM
            );
            
            if (shouldUpdate) {
                await updateLocksForContext(preset?.name);
            }
        }
    }
    
    // Preserve charLore existence and value BEFORE doing anything else
    let preservedCharLore = undefined;
    let preservedCharLoreExists = false;
    try {
        const currentSettings = getWorldInfoSettings() || {};
        if (currentSettings.world_info && Object.prototype.hasOwnProperty.call(currentSettings.world_info, 'charLore')) {
            preservedCharLoreExists = true;
            preservedCharLore = currentSettings.world_info.charLore;
        }
        console.log('STWIL: Preserved charLore state:', preservedCharLoreExists ? 'Found and preserved' : 'No charLore present');
    } catch (error) {
        console.warn('STWIL: Could not read existing charLore:', error.message);
    }
    
    // Clear world info (this may remove charLore from the system; we'll restore it later if needed)
    await executeSlashCommands('/world silent=true {{newline}}');
    settings.presetName = preset?.name ?? '';
    updateSelect();
    
    if (preset) {
        // Load preset worlds
        for (const world of preset.worldList) {
            await executeSlashCommands(`/world silent=true ${world}`);
        }
        
        // Apply world info settings if available, but do NOT overwrite an existing charLore.
        if (preset.worldInfoSettings && Object.keys(preset.worldInfoSettings).length > 0) {
            try {
                // Clone the preset settings so we can safely modify them
                const toApply = JSON.parse(JSON.stringify(preset.worldInfoSettings || {}));
                
                // Ensure world_info exists
                toApply.world_info = toApply.world_info || {};
                
                // If the extension previously had a charLore, preserve it rather than letting the preset overwrite it.
                if (preservedCharLoreExists) {
                    if (Object.prototype.hasOwnProperty.call(toApply.world_info, 'charLore')) {
                        // remove charLore from the preset to avoid overwriting
                        delete toApply.world_info.charLore;
                    }
                }
                
                // Apply settings using the safe helper (this will restore any preserved charLore)
                await safeSetWorldInfoSettings(toApply);
                console.log('STWIL: Applied preset world info settings (charLore preserved if present)');
            } catch (error) {
                console.log('STWIL: World info settings could not be applied:', error.message);
            }
        }
    }
    
    // ALWAYS ensure that if a charLore existed before we started, it still exists (restore if needed)
    if (preservedCharLoreExists) {
        try {
            const finalSettings = getWorldInfoSettings() || {};
            if (!finalSettings.world_info) finalSettings.world_info = {};
            finalSettings.world_info.charLore = preservedCharLore;
            // Use safeSetWorldInfoSettings to avoid accidental overwrites elsewhere
            await safeSetWorldInfoSettings(finalSettings);
            console.log('STWIL: Restored charLore successfully (guaranteed preserve)');
        } catch (error) {
            console.warn('STWIL: Failed to restore charLore:', error.message);
        }
    } else {
        // If there was no pre-existing charLore, do not remove anything created by the user
        console.log('STWIL: No pre-existing charLore to restore; leaving world info as-is.');
    }
    
    updateLockButton();
};

async function updateLocksForContext(presetName) {
    const context = getCurrentContext();
    
    if (getChatLock()) {
        setChatLock(presetName);
    }
    
    if (!context.isGroupChat && getCharacterLock(context.characterName)) {
        setCharacterLock(context.characterName, presetName);
    }
}

const updateSelect = ()=>{
    if (!presetSelect) return; // Guard against race condition
    
    // Update the blank option to show global default
    const blankOption = presetSelect.children[0];
    if (blankOption && blankOption.value === '') {
        blankOption.textContent = settings.globalDefaultPreset ? 
            `--- Default: ${settings.globalDefaultPreset} ---` : 
            '--- Pick a Preset ---';
    }
    
    // Simplified approach: remove all options except the blank one, then recreate
    const currentOptions = Array.from(presetSelect.options).slice(1);
    currentOptions.forEach(opt => opt.remove());
    
    // Create sorted list of new options
    const newSortedOptions = settings.presetList
        .map(preset => {
            const opt = document.createElement('option');
            opt.value = preset.name;
            opt.textContent = preset.name;
            const worldsText = preset.worldList.length > 0 ? preset.worldList.join(', ') : 'No worlds';
            const settingsText = preset.worldInfoSettings && Object.keys(preset.worldInfoSettings).length > 0 ? 'Includes WI settings' : 'No WI settings';
            opt.title = `${worldsText} | ${settingsText}`;
            return opt;
        })
        .sort((a, b) => a.value.toLowerCase().localeCompare(b.value.toLowerCase()));
    
    // Add the new sorted options
    newSortedOptions.forEach(opt => presetSelect.add(opt));
    
    // Re-set the selected value
    presetSelect.value = settings.presetName;
};

function updateLockButton() {
    if (!lockButton) return; // Guard against race condition
    
    if (hasAnyLocks()) {
        lockButton.classList.add(CSS_CLASSES.TOGGLE_ENABLED);
        lockButton.style.color = 'var(--active)';
    } else {
        lockButton.classList.remove(CSS_CLASSES.TOGGLE_ENABLED);
        lockButton.style.color = '';
    }
}

async function showLockSettings() {
    const context = getCurrentContext();
    const chatLock = getChatLock();
    const characterLock = getCharacterLock(context.characterName);
    
    const characterLockHtml = context.isGroupChat ? '' : `
        <label class="checkbox_label">
            <input type="checkbox" id="characterLockCheckbox" ${characterLock ? 'checked' : ''}>
            <span>Lock to character${context.characterName ? ` (${context.characterName})` : ''}</span>
        </label>
    `;

    const content = document.createElement('div');
    content.innerHTML = `
        <h3>Preset Locks</h3>
        <p>Lock the current preset "${settings.presetName || 'None'}" to this context:</p>
        <div>
            ${characterLockHtml}
            <label class="checkbox_label">
                <input type="checkbox" id="chatLockCheckbox" ${chatLock ? 'checked' : ''}>
                <span>Lock to chat</span>
            </label>
        </div>
        ${context.isGroupChat ? '<p><small>Character locks are disabled in group chats.</small></p>' : ''}
    `;
    
    const result = await callPopup(content, POPUP_TYPES.CONFIRM);
    
    if (result) {
        const chatLockChecked = content.querySelector('#chatLockCheckbox')?.checked || false;
        const characterLockChecked = content.querySelector('#characterLockCheckbox')?.checked || false;
        
        // Update chat lock
        setChatLock(chatLockChecked ? settings.presetName : null);
        
        // Update character lock (only if not in group chat)
        if (!context.isGroupChat && context.characterName) {
            setCharacterLock(context.characterName, characterLockChecked ? settings.presetName : null);
        }
        
        updateLockButton();
        
        if (settings.showLockNotifications) {
            const locks = [];
            if (chatLockChecked) locks.push('chat');
            if (characterLockChecked && !context.isGroupChat) locks.push('character');
            
            if (locks.length > 0) {
                toastr.success(`Preset "${settings.presetName}" locked to ${locks.join(' and ')}`, 'World Info Presets');
            } else {
                toastr.info('All locks removed', 'World Info Presets');
            }
        }
    }
}

async function showSettings() {
    const content = document.createElement('div');
    
    // Generate options for global default preset
    const presetOptions = settings.presetList
        .map(preset => `<option value="${preset.name}" ${preset.name === settings.globalDefaultPreset ? 'selected' : ''}>${preset.name}</option>`)
        .join('');
    
    content.innerHTML = `
        <h3>World Info Preset Settings</h3>
        <div>
            <div style="margin-bottom: 10px;">
                <label for="globalDefaultPreset" style="display: block; font-weight: bold; margin-bottom: 5px;">Global Default Preset:</label>
                <select id="globalDefaultPreset" style="width: 100%;">
                    <option value="">None</option>
                    ${presetOptions}
                </select>
                <small style="color: #888;">This preset will be applied when no specific preset is selected and no locks are active.</small>
            </div>
            <hr style="margin: 15px 0;">
            <label class="checkbox_label">
                <input type="checkbox" id="enableCharacterLocks" ${settings.enableCharacterLocks ? 'checked' : ''}>
                <span>Enable character locks</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="enableChatLocks" ${settings.enableChatLocks ? 'checked' : ''}>
                <span>Enable chat locks</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="preferChatOverCharacterLocks" ${settings.preferChatOverCharacterLocks ? 'checked' : ''}>
                <span>Prefer chat locks over character locks</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="showLockNotifications" ${settings.showLockNotifications ? 'checked' : ''}>
                <span>Show lock notifications</span>
            </label>
        </div>
    `;
    
    const result = await callPopup(content, POPUP_TYPES.CONFIRM);
    
    if (result) {
        const newGlobalDefault = content.querySelector('#globalDefaultPreset')?.value || '';
        const oldGlobalDefault = settings.globalDefaultPreset;
        
        settings.globalDefaultPreset = newGlobalDefault;
        settings.enableCharacterLocks = content.querySelector('#enableCharacterLocks')?.checked || false;
        settings.enableChatLocks = content.querySelector('#enableChatLocks')?.checked || false;
        settings.preferChatOverCharacterLocks = content.querySelector('#preferChatOverCharacterLocks')?.checked || false;
        settings.showLockNotifications = content.querySelector('#showLockNotifications')?.checked || false;
        
        saveSettingsDebounced();
        updateSelect(); // Update the blank option text
        
        // If global default changed and we're in a context with no locks and no preset, apply the new default
        if (newGlobalDefault !== oldGlobalDefault && !settings.presetName && !hasAnyLocks()) {
            checkAndApplyLocks();
        }
    }
}

const loadBook = async(name)=>{
    const result = await fetch('/api/worldinfo/get', {
        method: 'POST',
        headers: getRequestHeaders(),
        body: JSON.stringify({ name }),
    });
    if (result.ok) {
        const data = await result.json();
        data.entries = Object.keys(data.entries).map(it=>{
            data.entries[it].book = name;
            return data.entries[it];
        });
        data.book = name;
        return data;
    } else {
        toastr.warning(`Failed to load World Info book: ${name}`);
        return null; // Return null on failure to prevent undefined behavior
    }
};

const importBooks = async(data)=>{
    if (data.books && Object.keys(data.books).length > 0) {
        const doImport = await callPopup(`<h3>The preset contains World Info books. Import the books?<h3>`, POPUP_TYPES.CONFIRM);
        if (doImport) {
            for (const key of Object.keys(data.books)) {
                const book = data.books[key];
                const blob = new Blob([JSON.stringify(book)], { type:'text' });
                const file = new File([blob], `${key}.json`);
                await importWorldInfo(file);
            }
        }
    }
};

const importCharacterLocks = async(data)=>{
    if (data.characterLocks && Object.keys(data.characterLocks).length > 0) {
        const doImport = await callPopup(`<h3>The preset contains character locks. Import the character locks?<h3>`, 'confirm');
        if (doImport) {
            Object.assign(settings.characterLocks, data.characterLocks);
            saveSettingsDebounced();
        }
    }
};

const importGlobalDefault = async(data, presetName)=>{
    if (data.isGlobalDefault) {
        const doImport = await callPopup(`<h3>This preset was exported as a global default. Set "${presetName}" as your global default?<h3>`, 'confirm');
        if (doImport) {
            settings.globalDefaultPreset = presetName;
            updateSelect();
            saveSettingsDebounced();
        }
    }
};

/**
 * @param {FileList} files
 */
const importPreset = async(files)=>{
    for (let i = 0; i < files.length; i++) {
        await importSinglePreset(files.item(i));
    }
};

/**
 * @param {File} file
 */
const importSinglePreset = async(file)=>{
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        let old = settings.presetList.find(it=>it.name.toLowerCase() == data.name.toLowerCase());
        while (old) {
            const popupText = `
                <h3>Import World Info Preset: "${data.name}"</3>
                <h4>
                    A preset by that name already exists. Change the name to import under a new name,
                    or keep the name to ovewrite the existing preset.
                </h4>
            `;
            const newName = await callPopup(popupText, 'input', data.name);
            if (newName == data.name) {
                const overwrite = await callPopup(`<h3>Overwrite World Info Preset "${newName}"?</h3>`, 'confirm');
                if (overwrite) {
                    old.worldList = data.worldList;
                    // Import world info settings, excluding charLore from the file
                    if (data.worldInfoSettings) {
                        const importedSettings = { ...data.worldInfoSettings };
                        if (importedSettings.world_info?.charLore) {
                            delete importedSettings.world_info.charLore;
                        }
                        old.worldInfoSettings = importedSettings;
                    }
                    await importBooks(data);
                    await importCharacterLocks(data);
                    await importGlobalDefault(data, newName);
                    if (settings.preset == old) {
                        activatePreset(old);
                        saveSettingsDebounced();
                    }
                }
                return;
            } else {
                data.name = newName;
                old = settings.presetList.find(it=>it.name.toLowerCase() == data.name.toLowerCase());
            }
        }
        const preset = new Preset();
        preset.name = data.name;
        preset.worldList = data.worldList;
        // Import world info settings, excluding charLore from the file
        if (data.worldInfoSettings) {
            const importedSettings = { ...data.worldInfoSettings };
            if (importedSettings.world_info?.charLore) {
                delete importedSettings.world_info.charLore;
            }
            preset.worldInfoSettings = importedSettings;
        }
        settings.presetList.push(preset);
        await importBooks(data);
        await importCharacterLocks(data);
        await importGlobalDefault(data, preset.name);
        updateSelect();
        saveSettingsDebounced();
    } catch (ex) {
        toastr.error(`Failed to import "${file.name}":\n\n${ex.message}`);
    }
};

const createPreset = async()=>{
    const name = await callPopup('<h3>Preset Name:</h3>', POPUP_TYPES.INPUT, settings.presetName);
    if (!name) return;
    
    const preset = new Preset();
    preset.name = name;
    preset.worldList = [...world_info.globalSelect];
    
    // Capture current world info settings but exclude charLore
    try {
        const capturedSettings = getWorldInfoSettings();
        // If charLore exists, delete it from the object we are about to save
        if (capturedSettings.world_info?.charLore) {
            delete capturedSettings.world_info.charLore;
        }
        preset.worldInfoSettings = capturedSettings;
    } catch (error) {
        console.log('STWIL: Could not capture world info settings:', error.message);
        preset.worldInfoSettings = {};
    }
    
    settings.presetList.push(preset);
    settings.presetName = name;
    updateSelect();
    updateLockButton();
    saveSettingsDebounced();
};

// Event handlers
function onContextChanged(eventName) {
    console.log(`STWIL: ${eventName} changed`);
    clearContextCache();
    updateLockButton();
    setTimeout(() => {
        checkAndApplyLocks();
    }, 100);
}

function onCharacterChanged() {
    onContextChanged('Character');
}

function onChatChanged() {
    if (!settings.enableChatLocks) return;
    onContextChanged('Chat');
}

const init = ()=>{
    const container = document.querySelector('#WorldInfo > div > h3');
    if (!container) {
        console.warn('STWIL: WorldInfo container not found, retrying in 500ms...');
        setTimeout(init, 500);
        return;
    }
    
    const dom = document.createElement('div'); {
        dom.classList.add(CSS_CLASSES.STWIL_CONTAINER);
        presetSelect = document.createElement('select'); {
            presetSelect.classList.add(CSS_CLASSES.STWIL_PRESET);
            const blank = document.createElement('option'); {
                blank.value = '';
                blank.textContent = settings.globalDefaultPreset ? 
                    `--- Default: ${settings.globalDefaultPreset} ---` : 
                    '--- Pick a Preset ---';
                presetSelect.append(blank);
            }
            for (const preset of settings.presetList.toSorted((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
                const opt = document.createElement('option'); {
                    opt.value = preset.name;
                    opt.textContent = preset.name;
                    const worldsText = preset.worldList.length > 0 ? preset.worldList.join(', ') : 'No worlds';
                    const settingsText = preset.worldInfoSettings && Object.keys(preset.worldInfoSettings).length > 0 ? 'Includes WI settings' : 'No WI settings';
                    opt.title = `${worldsText} | ${settingsText}`;
                    presetSelect.append(opt);
                }
            }
            presetSelect.value = settings.presetName ?? '';
            presetSelect.addEventListener('change', async()=>{
                if (presetSelect.value === '') {
                    // Handle "--Default--" selection by applying global default if available
                    if (settings.globalDefaultPreset) {
                        const defaultPreset = settings.presetList.find(p => p.name === settings.globalDefaultPreset);
                        if (defaultPreset) {
                            await activatePreset(defaultPreset);
                            if (settings.showLockNotifications) {
                                toastr.info(`Applied global default preset "${settings.globalDefaultPreset}"`, 'World Info Presets');
                            }
                        } else {
                            // Global default preset not found, clear current preset
                            await activatePreset(null);
                        }
                    } else {
                        // No global default set, clear current preset
                        await activatePreset(null);
                    }
                } else {
                    await activatePresetByName(presetSelect.value);
                }
            });
            dom.append(presetSelect);
        }
        const actions = document.createElement('div'); {
            actions.classList.add(CSS_CLASSES.STWIL_ACTIONS);
            
            // Lock button
            lockButton = document.createElement('div'); {
                lockButton.classList.add(CSS_CLASSES.STWIL_ACTION);
                lockButton.classList.add(CSS_CLASSES.MENU_BUTTON);
                lockButton.classList.add('fa-solid', 'fa-lock');
                lockButton.title = 'Preset locks';
                lockButton.addEventListener('click', showLockSettings);
                actions.append(lockButton);
            }
            
            // Settings button
            settingsButton = document.createElement('div'); {
                settingsButton.classList.add(CSS_CLASSES.STWIL_ACTION);
                settingsButton.classList.add(CSS_CLASSES.MENU_BUTTON);
                settingsButton.classList.add('fa-solid', 'fa-gear');
                settingsButton.title = 'Settings';
                settingsButton.addEventListener('click', showSettings);
                actions.append(settingsButton);
            }
            
            const btnRename = document.createElement('div'); {
                btnRename.classList.add('stwil-action');
                btnRename.classList.add('menu_button');
                btnRename.classList.add('fa-solid', 'fa-pencil');
                btnRename.title = 'Rename current preset';
                btnRename.addEventListener('click', async()=>{
                    const oldName = settings.presetName;
                    const name = await callPopup('<h3>Rename Preset:</h3>', 'input', settings.presetName);
                    if (!name || name === oldName) return;
                    
                    // Update chat lock if it matches
                    const chatLock = getChatLock();
                    if (chatLock === oldName) {
                        setChatLock(name);
                    }
                    
                    // Update character locks that reference this preset
                    for (const [charName, lockedPreset] of Object.entries(settings.characterLocks)) {
                        if (lockedPreset === oldName) {
                            settings.characterLocks[charName] = name;
                        }
                    }
                    
                    // Update global default if it references this preset
                    if (settings.globalDefaultPreset === oldName) {
                        settings.globalDefaultPreset = name;
                    }
                    
                    settings.preset.name = name;
                    settings.presetName = name;
                    updateSelect();
                    saveSettingsDebounced();
                });
                actions.append(btnRename);
            }
            const btnUpdate = document.createElement('div'); {
                btnUpdate.classList.add('stwil-action');
                btnUpdate.classList.add('menu_button');
                btnUpdate.classList.add('fa-solid', 'fa-save');
                btnUpdate.title = 'Update current preset';
                btnUpdate.addEventListener('click', ()=>{
                    if (!settings.preset) return createPreset();
                    
                    settings.preset.worldList = [...world_info.globalSelect];
                    
                    // Update world info settings, excluding charLore
                    try {
                        const capturedSettings = getWorldInfoSettings();
                        // If charLore exists, delete it from the object we are about to save
                        if (capturedSettings.world_info?.charLore) {
                            delete capturedSettings.world_info.charLore;
                        }
                        settings.preset.worldInfoSettings = capturedSettings;
                    } catch (error) {
                        console.log('STWIL: Could not capture world info settings:', error.message);
                    }
                    
                    saveSettingsDebounced();
                });
                actions.append(btnUpdate);
            }
            const btnCreate = document.createElement('div'); {
                btnCreate.classList.add('stwil-action');
                btnCreate.classList.add('menu_button');
                btnCreate.classList.add('fa-solid', 'fa-file-circle-plus');
                btnCreate.title = 'Save current preset as';
                btnCreate.addEventListener('click', async()=>createPreset());
                actions.append(btnCreate);
            }
            const btnRestore = document.createElement('div'); {
                btnRestore.classList.add('stwil-action');
                btnRestore.classList.add('menu_button');
                btnRestore.classList.add('fa-solid', 'fa-rotate-left');
                btnRestore.title = 'Restore current preset';
                btnRestore.addEventListener('click', ()=>activatePreset(settings.preset, true));
                actions.append(btnRestore);
            }
            const importFile = document.createElement('input'); {
                importFile.classList.add('stwil-importFile');
                importFile.type = 'file';
                importFile.addEventListener('change', async()=>{
                    await importPreset(importFile.files);
                    importFile.value = null;
                });
            }
            const btnImport = document.createElement('div'); {
                btnImport.classList.add('stwil-action');
                btnImport.classList.add('menu_button');
                btnImport.classList.add('fa-solid', 'fa-file-import');
                btnImport.title = 'Import preset';
                btnImport.addEventListener('click', ()=>importFile.click());
                actions.append(btnImport);
            }
            const btnExport = document.createElement('div'); {
                btnExport.classList.add('stwil-action');
                btnExport.classList.add('menu_button');
                btnExport.classList.add('fa-solid', 'fa-file-export');
                btnExport.title = 'Export the current preset';
                btnExport.addEventListener('click', async () => {
                    if (!settings.preset) {
                        toastr.warning('No preset selected to export');
                        return;
                    }

                    // Create a container element for the popup's content
                    const content = document.createElement('div');
                    content.innerHTML = `
                        <h3>Export World Info Preset: "${settings.presetName}"</h3>
                        <div>
                            <label class="checkbox_label">
                                <input type="checkbox" id="includeBooks" checked>
                                <span>Include books' contents in export</span>
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="useCurrentSelection">
                                <span>Use currently selected books instead of preset definition</span>
                            </label>
                        </div>
                        <p><small>By default, exports the preset's defined book list. Check the second option to export your current working selection instead.</small></p>
                    `;

                    // Pass the element to the popup function
                    const result = await callPopup(content, 'confirm');
                    if (!result) return;

                    // Read checkbox values from the content element (still exists in memory)
                    const includeBooks = content.querySelector('#includeBooks')?.checked || false;
                    const useCurrentSelection = content.querySelector('#useCurrentSelection')?.checked || false;

                    const data = settings.preset.toJSON();

                    // Include character locks in export
                    const relevantLocks = {};
                    for (const [charName, lockedPreset] of Object.entries(settings.characterLocks)) {
                        if (lockedPreset === settings.presetName) {
                            relevantLocks[charName] = lockedPreset;
                        }
                    }
                    if (Object.keys(relevantLocks).length > 0) {
                        data.characterLocks = relevantLocks;
                    }
                    
                    // Include global default setting if this preset is the global default
                    if (settings.globalDefaultPreset === settings.presetName) {
                        data.isGlobalDefault = true;
                    }

                    if (includeBooks) {
                        let names = useCurrentSelection ? world_info.globalSelect : settings.preset?.worldList || [];
                        const books = {};
                        for (const book of names) {
                            const bookData = await loadBook(book);
                            if (bookData) {
                                books[book] = bookData;
                            }
                        }
                        data.books = books;
                    }

                    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `SillyTavern-WorldInfoPreset-${settings.presetName}.json`;
                    a.click();
                    URL.revokeObjectURL(url); // Clean up
                });
                actions.append(btnExport);
            }
            const btnDelete = document.createElement('div'); {
                btnDelete.classList.add('stwil-action');
                btnDelete.classList.add('menu_button');
                btnDelete.classList.add('redWarningBG');
                btnDelete.classList.add('fa-solid', 'fa-trash-can');
                btnDelete.title = 'Delete the current preset';
                btnDelete.addEventListener('click', async()=>{
                    if (settings.presetName == '') return;
                    const confirmed = await callPopup(`<h3>Delete World Info Preset "${settings.presetName}"?</h3>`, 'confirm');
                    if (confirmed) {
                        const presetName = settings.presetName;
                        
                        // Remove character locks that reference this preset
                        for (const [charName, lockedPreset] of Object.entries(settings.characterLocks)) {
                            if (lockedPreset === presetName) {
                                delete settings.characterLocks[charName];
                            }
                        }
                        
                        // Remove chat lock if it references this preset
                        const chatLock = getChatLock();
                        if (chatLock === presetName) {
                            setChatLock(null);
                        }
                        
                        // Remove global default if it references this preset
                        if (settings.globalDefaultPreset === presetName) {
                            settings.globalDefaultPreset = '';
                        }
                        
                        settings.presetList.splice(settings.presetList.indexOf(settings.preset), 1);
                        settings.presetName = '';
                        
                        // Deactivate all worlds to clear the deleted preset
                        await activatePreset(null, true);
                        
                        updateSelect();
                        updateLockButton();
                        saveSettingsDebounced();
                    }
                });
                actions.append(btnDelete);
            }
            dom.append(actions);
        }
        container.insertAdjacentElement('afterend', dom);
    }

    // Initialize lock button state
    updateLockButton();

    // Seed charLore store from whatever is currently in world info
    try {
        storeCharLoreIfExists();
    } catch(e) {
        console.warn('STWIL: charLore store init failed:', e?.message ?? e);
    }

    // Event listeners
    if (eventSource && event_types) {
        eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        eventSource.on(event_types.CHAT_LOADED, () => {
            clearContextCache(); // Clear cache when chat loads
            setTimeout(() => {
                updateLockButton();
                checkAndApplyLocks();
            }, 500);
        });
    }

    const sel = document.querySelector('#world_editor_select');
    if (!sel) {
        console.warn('STWIL: World editor select not found, book rename detection disabled');
        return;
    }
    
    let bookNames = Array.from(sel.children).map(it=>it.textContent);
    let lastRenameCheck = 0; // Throttling for rename detection
    const mo = new MutationObserver(async(muts)=>{
        console.log('[WIP]', '[BOOKS CHANGED]', muts);
        
        // Throttle rename detection to avoid excessive processing
        const now = Date.now();
        if (now - lastRenameCheck < 1000) return;
        lastRenameCheck = now;
        
        const newNames = Array.from(sel.children).map(it=>it.textContent);
        const added = [];
        const removed = [];
        for (const nn of newNames) {
            if (!bookNames.includes(nn)) added.push(nn);
        }
        for (const bn of bookNames) {
            if (!newNames.includes(bn)) removed.push(bn);
        }
        if (added.length == 1 && removed.length == 1) {
            const oldName = removed[0];
            const newName = added[0];
            const presets = settings.presetList.filter(preset=>preset.worldList.includes(oldName));
            if (presets.length > 0) {
                // oldName has probably been renamed to newName
                const popupText = `
                    <div style="text-align:left;">
                        <h3>World Info Renamed</h3>
                        <p>It looks like you renamed the World Info book "${oldName}" to "${newName}".</p>
                        <p>The following presets currently include the World Info book "${oldName}":</p>
                        <ul>
                            ${presets.map(it=>`<li>${it.name}</li>`).join('')}
                        </ul>
                        <p>
                            Do you want to update all ${presets.length} presets that include "<strong>${oldName}</strong>" to now include "<strong>${newName}</strong>" instead?
                        </p>
                    </div>
                `;
                const dlg = new Popup(popupText, POPUP_TYPE.CONFIRM);
                await dlg.show();
                if (dlg.result == POPUP_RESULT.AFFIRMATIVE) {
                    for (const preset of presets) {
                        preset.worldList.splice(preset.worldList.indexOf(oldName), 1, newName);
                    }
                    saveSettingsDebounced();
                    updateSelect(); // Update the UI to reflect changes
                }
            }
        }
        bookNames = [...newNames];
    });
    mo.observe(sel, { childList: true });
};

init();

registerSlashCommand('wipreset',
    (args, value)=>{
        activatePresetByName(value);
    },
    [],
    '<span class="monospace">(optional preset name)</span> – Activate a World Info preset. Leave name blank to deactivate current preset (unload all WI books).',
    true,
    true,
);
