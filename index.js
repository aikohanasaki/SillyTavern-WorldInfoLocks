// World Info Preset Locking Extension for SillyTavern
// Features: Character & chat locks, import/export, rename detection, transfer functionality
// Enhanced with robust error handling and DOM safety checks

import { callPopup, eventSource, event_types, getRequestHeaders, saveSettingsDebounced, chat_metadata, name2, systemUserName, neutralCharacterName } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import { executeSlashCommands, registerSlashCommand } from '../../../slash-commands.js';
import { delay, navigation_option } from '../../../utils.js';
import { createWorldInfoEntry, deleteWIOriginalDataValue, deleteWorldInfoEntry, importWorldInfo, loadWorldInfo, saveWorldInfo, world_info } from '../../../world-info.js';

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

    toJSON() {
        return {
            name: this.name,
            worldList: this.worldList,
        };
    }
}

/**@type {Settings}*/
export const settings = Settings.from(extension_settings.worldInfoPresets ?? {});

/**@type {HTMLSelectElement}*/
let presetSelect;
let lockButton;
let settingsButton;

// Character and context detection functions (copied from STChatModelTemp)
function getCharacterNameForSettings() {
    // Primary: Use name2 variable from script.js
    let rawCharacterName = name2;
    let source = 'name2';

    // Fallback: Use chat_metadata.character_name if name2 is not available
    if (!rawCharacterName || rawCharacterName === systemUserName || rawCharacterName === neutralCharacterName) {
        rawCharacterName = chat_metadata?.character_name;
        source = 'chat_metadata';

        if (!rawCharacterName) {
            console.warn('STWIP: No character name available in name2 or chat_metadata');
            return null;
        }
    }

    let characterName = String(rawCharacterName).trim();

    // Normalize unicode characters to handle special characters consistently
    if (characterName.normalize) {
        characterName = characterName.normalize('NFC');
    }

    console.log(`STWIP: Raw character name from ${source}:`, rawCharacterName);
    console.log('STWIP: Normalized character name:', characterName);

    return characterName;
}

function getCurrentContext() {
    const characterName = getCharacterNameForSettings();
    const chatId = chat_metadata?.file_name || null;
    const isGroupChat = !!window.selected_group;
    
    return {
        characterName,
        chatId,
        isGroupChat
    };
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
    const chatLock = getChatLock();
    const characterLock = getCharacterLock(context.characterName);
    
    if (settings.preferChatOverCharacterLocks) {
        return chatLock || characterLock;
    } else {
        return characterLock || chatLock;
    }
}

function hasAnyLocks() {
    const context = getCurrentContext();
    const chatLock = getChatLock();
    const characterLock = getCharacterLock(context.characterName);
    return !!(chatLock || characterLock);
}

async function checkAndApplyLocks() {
    // Add robustness for cases where character data isn't loaded yet
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
        
        // Data is available but no locks, exit
        break;
    }
    
    if (attempts >= maxAttempts) {
        console.warn('STWIP: Timed out waiting for character/chat data to load for lock check');
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
                'confirm'
            );
            
            if (shouldUpdate) {
                await updateLocksForContext(preset?.name);
            }
        }
    }
    
    //TODO use delta instead of brute force
    await executeSlashCommands('/world silent=true {{newline}}');
    settings.presetName = preset?.name ?? '';
    updateSelect();
    updateLockButton();
    
    if (preset) {
        for (const world of settings.presetList.find(it=>it.name == settings.presetName).worldList) {
            await executeSlashCommands(`/world silent=true ${world}`);
        }
    }
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
    
    /**@type {HTMLOptionElement[]}*/
    // @ts-ignore
    const opts = Array.from(presetSelect.children);

    const added = [];
    const removed = [];
    const updated = [];
    for (const preset of settings.presetList) {
        const opt = opts.find(opt=>opt.value.toLowerCase() == preset.name.toLowerCase());
        if (opt) {
            if (opt.value != preset.name) {
                updated.push({ preset, opt });
            }
        } else {
            added.push(preset);
        }
    }
    for (const opt of opts) {
        if (opt.value == '') continue;
        if (settings.presetList.find(preset=>opt.value.toLowerCase() == preset.name.toLowerCase())) continue;
        removed.push(opt);
    }
    for (const opt of removed) {
        opt.remove();
        opts.splice(opts.indexOf(opt), 1);
    }
    for (const update of updated) {
        update.opt.value = update.preset.name;
        update.opt.textContent = update.preset.name;
    }
    const sortedOpts = opts.toSorted((a,b)=>a.value.toLowerCase().localeCompare(b.value.toLowerCase()));
    sortedOpts.forEach((opt, idx)=>{
        if (presetSelect.children[idx] != opt) {
            presetSelect.children[idx].insertAdjacentElement('beforebegin', opt);
        }
    });
    for (const preset of added) {
        const opt = document.createElement('option'); {
            opt.value = preset.name;
            opt.textContent = preset.name;
            const before = Array.from(presetSelect.children).find(it=>it.value.toLowerCase().localeCompare(preset.name.toLowerCase()) == 1);
            if (before) before.insertAdjacentElement('beforebegin', opt);
            else presetSelect.append(opt);
        }
    }
    presetSelect.value = settings.presetName;
};

function updateLockButton() {
    if (!lockButton) return; // Guard against race condition
    
    if (hasAnyLocks()) {
        lockButton.classList.add('toggleEnabled');
        lockButton.style.color = 'var(--active)';
    } else {
        lockButton.classList.remove('toggleEnabled');
        lockButton.style.color = '';
    }
}

async function showLockSettings() {
    const context = getCurrentContext();
    const chatLock = getChatLock();
    const characterLock = getCharacterLock(context.characterName);
    
    const characterLockCheckbox = context.isGroupChat ? '' : `
        <label class="checkbox_label">
            <input type="checkbox" id="characterLockCheckbox" ${characterLock ? 'checked' : ''}>
            <span>Lock to character${context.characterName ? ` (${context.characterName})` : ''}</span>
        </label>
    `;
    
    const popupContent = `
        <h3>Preset Locks</h3>
        <p>Lock the current preset "${settings.presetName || 'None'}" to this context:</p>
        <div>
            ${characterLockCheckbox}
            <label class="checkbox_label">
                <input type="checkbox" id="chatLockCheckbox" ${chatLock ? 'checked' : ''}>
                <span>Lock to chat</span>
            </label>
        </div>
        ${context.isGroupChat ? '<p><small>Character locks are disabled in group chats.</small></p>' : ''}
    `;
    
    const result = await callPopup(popupContent, 'confirm');
    
    if (result) {
        const popup = document.querySelector('.popup');
        const chatLockChecked = popup.querySelector('#chatLockCheckbox')?.checked || false;
        const characterLockChecked = popup.querySelector('#characterLockCheckbox')?.checked || false;
        
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
    const popupContent = `
        <h3>World Info Preset Settings</h3>
        <div>
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
    
    const result = await callPopup(popupContent, 'confirm');
    
    if (result) {
        const popup = document.querySelector('.popup');
        settings.enableCharacterLocks = popup.querySelector('#enableCharacterLocks')?.checked || false;
        settings.enableChatLocks = popup.querySelector('#enableChatLocks')?.checked || false;
        settings.preferChatOverCharacterLocks = popup.querySelector('#preferChatOverCharacterLocks')?.checked || false;
        settings.showLockNotifications = popup.querySelector('#showLockNotifications')?.checked || false;
        
        saveSettingsDebounced();
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
    }
};

const importBooks = async(data)=>{
    if (data.books && Object.keys(data.books).length > 0) {
        const doImport = await callPopup(`<h3>The preset contains World Info books. Import the books?<h3>`, 'confirm');
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
                    await importBooks(data);
                    await importCharacterLocks(data);
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
        settings.presetList.push(preset);
        await importBooks(data);
        await importCharacterLocks(data);
        updateSelect();
        saveSettingsDebounced();
    } catch (ex) {
        toastr.error(`Failed to import "${file.name}":\n\n${ex.message}`);
    }
};

const createPreset = async()=>{
    const name = await callPopup('<h3>Preset Name:</h3>', 'input', settings.presetName);
    if (!name) return;
    const preset = new Preset();
    preset.name = name;
    preset.worldList = [...world_info.globalSelect];
    settings.presetList.push(preset);
    settings.presetName = name;
    updateSelect();
    updateLockButton();
    saveSettingsDebounced();
};

// Event handlers
function onCharacterChanged() {
    if (!settings.enableCharacterLocks && !settings.enableChatLocks) return;
    
    console.log('STWIP: Character changed');
    updateLockButton();
    setTimeout(() => {
        checkAndApplyLocks();
    }, 100);
}

function onChatChanged() {
    if (!settings.enableChatLocks) return;
    
    console.log('STWIP: Chat changed');
    updateLockButton();
    setTimeout(() => {
        checkAndApplyLocks();
    }, 100);
}

const init = ()=>{
    const container = document.querySelector('#WorldInfo > div > h3');
    if (!container) {
        console.warn('STWIP: WorldInfo container not found, retrying in 500ms...');
        setTimeout(init, 500);
        return;
    }
    
    const dom = document.createElement('div'); {
        dom.classList.add('stwip--container');
        presetSelect = document.createElement('select'); {
            presetSelect.classList.add('stwip--preset');
            const blank = document.createElement('option'); {
                blank.value = '';
                blank.textContent = '--- Pick a Preset ---';
                presetSelect.append(blank);
            }
            for (const preset of settings.presetList.toSorted((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
                const opt = document.createElement('option'); {
                    opt.value = preset.name;
                    opt.textContent = preset.name;
                    opt.title = preset.worldList.join(', ');
                    presetSelect.append(opt);
                }
            }
            presetSelect.value = settings.presetName ?? '';
            presetSelect.addEventListener('change', async()=>{
                await activatePresetByName(presetSelect.value);
            });
            dom.append(presetSelect);
        }
        const actions = document.createElement('div'); {
            actions.classList.add('stwip--actions');
            
            // Lock button
            lockButton = document.createElement('div'); {
                lockButton.classList.add('stwip--action');
                lockButton.classList.add('menu_button');
                lockButton.classList.add('fa-solid', 'fa-lock');
                lockButton.title = 'Preset locks';
                lockButton.addEventListener('click', showLockSettings);
                actions.append(lockButton);
            }
            
            // Settings button
            settingsButton = document.createElement('div'); {
                settingsButton.classList.add('stwip--action');
                settingsButton.classList.add('menu_button');
                settingsButton.classList.add('fa-solid', 'fa-gear');
                settingsButton.title = 'Settings';
                settingsButton.addEventListener('click', showSettings);
                actions.append(settingsButton);
            }
            
            const btnRename = document.createElement('div'); {
                btnRename.classList.add('stwip--action');
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
                    
                    settings.preset.name = name;
                    settings.presetName = name;
                    updateSelect();
                    saveSettingsDebounced();
                });
                actions.append(btnRename);
            }
            const btnUpdate = document.createElement('div'); {
                btnUpdate.classList.add('stwip--action');
                btnUpdate.classList.add('menu_button');
                btnUpdate.classList.add('fa-solid', 'fa-save');
                btnUpdate.title = 'Update current preset';
                btnUpdate.addEventListener('click', ()=>{
                    if (!settings.preset) return createPreset();
                    settings.preset.worldList = [...world_info.globalSelect];
                    saveSettingsDebounced();
                });
                actions.append(btnUpdate);
            }
            const btnCreate = document.createElement('div'); {
                btnCreate.classList.add('stwip--action');
                btnCreate.classList.add('menu_button');
                btnCreate.classList.add('fa-solid', 'fa-file-circle-plus');
                btnCreate.title = 'Save current preset as';
                btnCreate.addEventListener('click', async()=>createPreset());
                actions.append(btnCreate);
            }
            const btnRestore = document.createElement('div'); {
                btnRestore.classList.add('stwip--action');
                btnRestore.classList.add('menu_button');
                btnRestore.classList.add('fa-solid', 'fa-rotate-left');
                btnRestore.title = 'Restore current preset';
                btnRestore.addEventListener('click', ()=>activatePreset(settings.preset, true));
                actions.append(btnRestore);
            }
            const importFile = document.createElement('input'); {
                importFile.classList.add('stwip--importFile');
                importFile.type = 'file';
                importFile.addEventListener('change', async()=>{
                    await importPreset(importFile.files);
                    importFile.value = null;
                });
            }
            const btnImport = document.createElement('div'); {
                btnImport.classList.add('stwip--action');
                btnImport.classList.add('menu_button');
                btnImport.classList.add('fa-solid', 'fa-file-import');
                btnImport.title = 'Import preset';
                btnImport.addEventListener('click', ()=>importFile.click());
                actions.append(btnImport);
            }
            const btnExport = document.createElement('div'); {
                btnExport.classList.add('stwip--action');
                btnExport.classList.add('menu_button');
                btnExport.classList.add('fa-solid', 'fa-file-export');
                btnExport.title = 'Export the current preset';
                btnExport.addEventListener('click', async()=>{
                    if (!settings.preset) {
                        toastr.warning('No preset selected to export');
                        return;
                    }
                    
                    const popupText = `
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
                    const result = await callPopup(popupText, 'confirm');
                    if (!result) return;
                    
                    const popup = document.querySelector('.popup');
                    const includeBooks = popup.querySelector('#includeBooks')?.checked || false;
                    const useCurrentSelection = popup.querySelector('#useCurrentSelection')?.checked || false;
                    
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
                    
                    if (includeBooks) {
                        // Use current selection or preset definition
                        let names = useCurrentSelection ? world_info.globalSelect : settings.preset?.worldList || [];
                        const books = {};
                        for (const book of names) {
                            books[book] = await loadBook(book);
                        }
                        data.books = books;
                    }
                    const blob = new Blob([JSON.stringify(data)], { type:'text' });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a'); {
                        a.href = url;
                        const name = `SillyTavern-WorldInfoPreset-${settings.presetName}`;
                        const ext = 'json';
                        a.download = `${name}.${ext}`;
                        a.click();
                    }
                });
                actions.append(btnExport);
            }
            const btnDelete = document.createElement('div'); {
                btnDelete.classList.add('stwip--action');
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

    // Event listeners
    if (eventSource && event_types) {
        eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        eventSource.on(event_types.CHAT_LOADED, () => {
            setTimeout(() => {
                updateLockButton();
                checkAndApplyLocks();
            }, 500);
        });
    }

    const sel = document.querySelector('#world_editor_select');
    if (!sel) {
        console.warn('STWIP: World editor select not found, book rename detection disabled');
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
                }
            } else {
                // toastr.info(`World Info book renamed, but not included in any presets: "${oldName}" => "${newName}"`);
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

// Transfer functionality (keeping existing code)
const initTransfer = ()=>{
    const alterTemplate = ()=>{
        const tpl = document.querySelector('#entry_edit_template');
        if (!tpl) {
            console.warn('STWIP: Entry edit template not found, transfer functionality disabled');
            return false;
        }
        
        const duplicateBtn = tpl.querySelector('.duplicate_entry_button');
        if (!duplicateBtn) {
            console.warn('STWIP: Duplicate entry button not found, transfer functionality disabled');
            return false;
        }
        
        const transferBtn = document.createElement('i'); {
            transferBtn.classList.add('stwip--transfer');
            transferBtn.classList.add('menu_button');
            transferBtn.classList.add('fa-solid');
            transferBtn.classList.add('fa-truck-arrow-right');
            transferBtn.title = 'Transfer or copy world info entry into another book';
            duplicateBtn.insertAdjacentElement('beforebegin', transferBtn);
        }
        return true;
    };
    
    if (!alterTemplate()) return;

    const entriesList = document.querySelector('#world_popup_entries_list');
    if (!entriesList) {
        console.warn('STWIP: World entries list not found, transfer functionality disabled');
        return;
    }

    const mo = new MutationObserver(muts=>{
        for (const entry of [...document.querySelectorAll('#world_popup_entries_list .world_entry:not(.stwip--)')]) {
            const uid = entry.getAttribute('uid');
            entry.classList.add('stwip--');
            const transferBtn = entry.querySelector('.stwip--transfer');
            if (!transferBtn) continue; // Skip if transfer button not found
            
            transferBtn.addEventListener('click', async(evt)=>{
                evt.stopPropagation();
                let sel;
                let isCopy = false;
                const dom = document.createElement('div'); {
                    dom.classList.add('stwip--transferModal');
                    const title = document.createElement('h3'); {
                        title.textContent = 'Transfer World Info Entry';
                        dom.append(title);
                    }
                    const subTitle = document.createElement('h4'); {
                        const entryName = transferBtn.closest('.world_entry').querySelector('[name="comment"]').value ?? transferBtn.closest('.world_entry').querySelector('[name="key"]').value;
                        const bookName = document.querySelector('#world_editor_select').selectedOptions[0].textContent;
                        subTitle.textContent = `${bookName}: ${entryName}`;
                        dom.append(subTitle);
                    }
                    sel = document.querySelector('#world_editor_select').cloneNode(true); {
                        sel.classList.add('stwip--worldSelect');
                        sel.value = document.querySelector('#world_editor_select').value;
                        sel.addEventListener('keyup', (evt)=>{
                            if (evt.key == 'Shift') {
                                (dlg.dom ?? dlg.dlg).classList.remove('stwip--isCopy');
                                return;
                            }
                        });
                        sel.addEventListener('keydown', (evt)=>{
                            if (evt.key == 'Shift') {
                                (dlg.dom ?? dlg.dlg).classList.add('stwip--isCopy');
                                return;
                            }
                            if (!evt.ctrlKey && !evt.altKey && evt.key == 'Enter') {
                                evt.preventDefault();
                                if (evt.shiftKey) isCopy = true;
                                dlg.completeAffirmative();
                            }
                        });
                        dom.append(sel);
                    }
                    const hintP = document.createElement('p'); {
                        const hint = document.createElement('small'); {
                            hint.textContent = 'Type to select book. Enter to transfer. Shift+Enter to copy.';
                            hintP.append(hint);
                        }
                        dom.append(hintP);
                    }
                }
                const dlg = new Popup(dom, POPUP_TYPE.CONFIRM, null, { okButton:'Transfer', cancelButton:'Cancel' });
                const copyBtn = document.createElement('div'); {
                    copyBtn.classList.add('stwip--copy');
                    copyBtn.classList.add('menu_button');
                    copyBtn.textContent = 'Copy';
                    copyBtn.addEventListener('click', ()=>{
                        isCopy = true;
                        dlg.completeAffirmative();
                    });
                    (dlg.ok ?? dlg.okButton).insertAdjacentElement('afterend', copyBtn);
                }
                const prom = dlg.show();
                sel.focus();
                await prom;
                if (dlg.result == POPUP_RESULT.AFFIRMATIVE) {
                    toastr.info('Transferring WI Entry');
                    console.log('TRANSFER TO', sel.value);
                    const srcName = document.querySelector('#world_editor_select').selectedOptions[0].textContent;
                    const dstName = sel.selectedOptions[0].textContent;
                    if (srcName == dstName) {
                        toastr.warning(`Entry is already in book "${dstName}"`);
                        return;
                    }
                    let page = document.querySelector('#world_info_pagination .paginationjs-prev[data-num]')?.getAttribute('data-num');
                    if (page === undefined) {
                        page = document.querySelector('#world_info_pagination .paginationjs-next[data-num]')?.getAttribute('data-num');
                        if (page !== undefined) {
                            page = (Number(page) - 1).toString();
                        }
                    } else {
                        page = (Number(page) + 1).toString();
                    }
                    const [srcBook, dstBook] = await Promise.all([
                        loadWorldInfo(srcName),
                        loadWorldInfo(dstName),
                    ]);
                    if (srcBook && dstBook) {
                        const srcEntry = srcBook.entries[uid];
                        const oData = Object.assign({}, srcEntry);
                        delete oData.uid;
                        const dstEntry = createWorldInfoEntry(null, dstBook);
                        Object.assign(dstEntry, oData);
                        await saveWorldInfo(dstName, dstBook, true);
                        if (!isCopy) {
                            const deleted = await deleteWorldInfoEntry(srcBook, uid, { silent:true });
                            if (deleted) {
                                deleteWIOriginalDataValue(srcBook, uid);
                                await saveWorldInfo(srcName, srcBook, true);
                            }
                        }
                        toastr.info('Almost transferred...');
                        document.querySelector('#world_editor_select').value = '';
                        let saveProm = new Promise(resolve=>eventSource.once(event_types.WORLDINFO_UPDATED, resolve));
                        document.querySelector('#world_editor_select').dispatchEvent(new Event('change', {  bubbles:true }));
                        await saveProm;
                        
                        document.querySelector('#world_editor_select').value = [...document.querySelector('#world_editor_select').children].find(it=>it.textContent == srcName).value;
                        saveProm = new Promise(resolve=>eventSource.once(event_types.WORLDINFO_UPDATED, resolve));
                        document.querySelector('#world_editor_select').dispatchEvent(new Event('change', {  bubbles:true }));
                        await saveProm;
                        if (page !== undefined) {
                            saveProm = new Promise(resolve=>eventSource.once(event_types.WORLDINFO_UPDATED, resolve));
                            document.querySelector('#world_info_pagination .paginationjs-next').setAttribute('data-num', page.toString());
                            document.querySelector('#world_info_pagination .paginationjs-next').click();
                            await saveProm;
                        }
                        toastr.success('Transferred WI Entry');
                    } else {
                        toastr.error('Something went wrong');
                    }
                }
            });
        }
    });
    mo.observe(entriesList, { childList:true, subtree:true });

    const loadBook = async(name)=>{
        const result = await fetch('/api/worldinfo/get', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name }),
        });
        if (result.ok) {
            return await result.json();
        } else {
            toastr.warning(`Failed to load World Info book: ${name}`);
        }
    };
    const saveBook = async(name, data)=>{
        await fetch('/api/worldinfo/edit', {
            method: 'POST',
            headers: getRequestHeaders(),
            body: JSON.stringify({ name, data }),
        });
        eventSource.emit(event_types.WORLDINFO_UPDATED, name, data);
    };
};