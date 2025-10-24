import { callPopup, eventSource, event_types, getRequestHeaders, saveSettingsDebounced, chat_metadata, name2, systemUserName, neutralCharacterName } from '../../../../script.js';
import { extension_settings, saveMetadataDebounced } from '../../../extensions.js';
import { POPUP_RESULT, POPUP_TYPE, Popup } from '../../../popup.js';
import { executeSlashCommands, registerSlashCommand } from '../../../slash-commands.js';
import { importWorldInfo, world_info, getWorldInfoSettings } from '../../../world-info.js';
import { selected_group, groups } from '../../../group-chats.js';
import { escapeHtml } from '../../../utils.js';
import { t } from '../../../i18n.js';

// Context cache to avoid redundant character name lookups
let cachedContext = null;
let cacheTimestamp = 0;
const CACHE_DURATION_MS = 100; // Cache valid for 100ms

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
    /**@type {Object.<string, string>}*/ groupLocks = {}; // groupId -> presetName
    /**@type {boolean}*/ preferChatOverCharacterLocks = false;
    /**@type {boolean}*/ enableCharacterLocks = true;
    /**@type {boolean}*/ enableChatLocks = true;
    /**@type {boolean}*/ enableGroupLocks = true;
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
    /**@type {Object|null}*/ worldInfoSettings = null;

    toJSON() {
        return {
            name: this.name,
            worldList: this.worldList,
            worldInfoSettings: this.worldInfoSettings,
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
    // Check if we're in a group chat first
    const isGroupChat = !!selected_group;

    if (isGroupChat) {
        // For group chats, this function should return null since groups are handled separately
        return null;
    }

    // For single character chats, use existing logic
    // Primary: Use name2 variable from script.js
    let rawCharacterName = name2;
    let source = 'name2';

    // Fallback: Use chat_metadata.character_name if name2 is not available
    if (!rawCharacterName || rawCharacterName === systemUserName || rawCharacterName === neutralCharacterName) {
        rawCharacterName = chat_metadata?.character_name;
        source = 'chat_metadata';

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

    console.log(`STWIL: Raw character name from ${source}:`, rawCharacterName);
    console.log('STWIL: Normalized character name:', characterName);

    return characterName;
}

function snapshotWorldInfoSettings() {
    const s = getWorldInfoSettings();
    // Only keep the fields you asked for (and avoid saving the whole world_info object)
    return {
        world_info_depth: s.world_info_depth,
        world_info_min_activations: s.world_info_min_activations,
        world_info_min_activations_depth_max: s.world_info_min_activations_depth_max,
        world_info_budget: s.world_info_budget,
        world_info_include_names: s.world_info_include_names,
        world_info_recursive: s.world_info_recursive,
        world_info_overflow_alert: s.world_info_overflow_alert,
        world_info_case_sensitive: s.world_info_case_sensitive,
        world_info_match_whole_words: s.world_info_match_whole_words,
        world_info_character_strategy: s.world_info_character_strategy,
        world_info_budget_cap: s.world_info_budget_cap,
        world_info_use_group_scoring: s.world_info_use_group_scoring,
        world_info_max_recursion_steps: s.world_info_max_recursion_steps,
    };
}

function validateSettingsApplied(expectedSettings, logPrefix = 'STWIL') {
    const currentSettings = snapshotWorldInfoSettings();
    const mismatches = [];

    for (const [key, expectedValue] of Object.entries(expectedSettings)) {
        const currentValue = currentSettings[key];

        // Handle different types of comparisons
        let matches = false;
        if (typeof expectedValue === 'boolean' && typeof currentValue === 'boolean') {
            matches = expectedValue === currentValue;
        } else if (typeof expectedValue === 'number' && typeof currentValue === 'number') {
            matches = expectedValue === currentValue;
        } else {
            // Convert both to strings for comparison
            matches = String(expectedValue) === String(currentValue);
        }

        if (!matches) {
            mismatches.push({
                key,
                expected: expectedValue,
                actual: currentValue,
                expectedType: typeof expectedValue,
                actualType: typeof currentValue
            });
        }
    }

    if (mismatches.length > 0) {
        console.warn(`${logPrefix}: Settings validation failed. Mismatches found:`, mismatches);
        return { success: false, mismatches };
    }

    console.log(`${logPrefix}: Settings validation passed. All ${Object.keys(expectedSettings).length} settings applied correctly.`);
    return { success: true, mismatches: [] };
}

function getSettingsCategories() {
    return {
        activation: {
            name: t`Activation Settings`,
            description: t`Controls when and how world info entries are activated`,
            settings: [
                'world_info_depth',
                'world_info_min_activations',
                'world_info_min_activations_depth_max',
                'world_info_recursive',
                'world_info_max_recursion_steps'
            ]
        },
        budget: {
            name: t`Budget & Performance`,
            description: t`Controls memory usage and token limits`,
            settings: [
                'world_info_budget',
                'world_info_budget_cap',
                'world_info_overflow_alert'
            ]
        },
        matching: {
            name: t`Text Matching`,
            description: t`Controls how keywords are matched in text`,
            settings: [
                'world_info_case_sensitive',
                'world_info_match_whole_words',
                'world_info_include_names'
            ]
        },
        strategy: {
            name: t`Strategy & Scoring`,
            description: t`Controls activation priority and scoring behavior`,
            settings: [
                'world_info_character_strategy',
                'world_info_use_group_scoring'
            ]
        }
    };
}

function generatePresetTooltip(preset) {
    const booksList = preset.worldList.join(', ') || t`None`;
    let tooltip = t`Books: ${booksList}`;

    if (preset.worldInfoSettings && Object.keys(preset.worldInfoSettings).length > 0) {
        tooltip += `\n\n${t`World Info Settings:`}`;

        const categories = getSettingsCategories();
        const settingsByCategory = {};

        // Group settings by category
        for (const [catKey, category] of Object.entries(categories)) {
            for (const setting of category.settings) {
                if (preset.worldInfoSettings.hasOwnProperty(setting)) {
                    if (!settingsByCategory[catKey]) {
                        settingsByCategory[catKey] = [];
                    }
                    settingsByCategory[catKey].push({
                        name: setting.replace('world_info_', ''),
                        value: preset.worldInfoSettings[setting]
                    });
                }
            }
        }

        // Add categorized settings to tooltip
        for (const [catKey, settings] of Object.entries(settingsByCategory)) {
            const category = categories[catKey];
            tooltip += `\n• ${category.name}:`;
            for (const setting of settings) {
                tooltip += `\n  ${setting.name}: ${setting.value}`;
            }
        }

        // Add any uncategorized settings
        const categorizedSettings = Object.values(categories).flatMap(cat => cat.settings);
        const uncategorizedSettings = Object.keys(preset.worldInfoSettings).filter(
            setting => !categorizedSettings.includes(setting)
        );

        if (uncategorizedSettings.length > 0) {
            tooltip += `\n• ${t`Other:`}`;
            for (const setting of uncategorizedSettings) {
                tooltip += `\n  ${setting.replace('world_info_', '')}: ${preset.worldInfoSettings[setting]}`;
            }
        }
    } else if (preset.worldInfoSettings === null) {
        tooltip += `\n\n${t`No world info settings included`}`;
    } else {
        tooltip += `\n\n${t`No world info settings configured`}`;
    }

    return tooltip;
}

function migratePresetsToIncludeSettings() {
    let migrated = 0;
    const currentSettings = snapshotWorldInfoSettings();

    for (const preset of settings.presetList) {
        if (!preset.worldInfoSettings) {
            // Use current global settings as default for legacy presets
            preset.worldInfoSettings = currentSettings;
            migrated++;
            console.log(`STWIL: Migrated preset "${preset.name}" to include world info settings`);
        }
    }

    if (migrated > 0) {
        saveSettingsDebounced();
        console.log(`STWIL: Migration complete. Updated ${migrated} presets to include global settings`);

        if (settings.showLockNotifications) {
            toastr.info(t`Migrated ${migrated} presets to include global world info settings`, t`World Info Presets`);
        }
    }

    return migrated;
}

function migrateGroupLocksFromCharacterLocks() {
    // Check if we have any group names in characterLocks that should be moved to groupLocks
    if (!settings.characterLocks || Object.keys(settings.characterLocks).length === 0) {
        return; // Nothing to migrate
    }

    // Initialize groupLocks if it doesn't exist
    if (!settings.groupLocks) {
        settings.groupLocks = {};
    }

    let migrated = 0;
    const groupsToMigrate = [];

    // Check each characterLock to see if it matches a group name
    for (const [lockKey, presetName] of Object.entries(settings.characterLocks)) {
        // Try to find a group with this name
        const group = groups?.find(g => g.name === lockKey);
        if (group) {
            groupsToMigrate.push({
                key: lockKey,
                presetName: presetName,
                groupId: group.id,
                groupName: group.name
            });
        }
    }

    // Migrate the identified group locks
    for (const migration of groupsToMigrate) {
        // Move to groupLocks using ID
        settings.groupLocks[migration.groupId] = migration.presetName;

        // Remove from characterLocks
        delete settings.characterLocks[migration.key];

        migrated++;
        console.log(`STWIL: Migrated group lock from character name "${migration.groupName}" to group ID "${migration.groupId}"`);
    }

    if (migrated > 0) {
        saveSettingsDebounced();
        console.log(`STWIL: Group lock migration complete. Migrated ${migrated} group locks from character storage`);

        if (settings.showLockNotifications) {
            toastr.info(t`Migrated ${migrated} group locks to use group IDs instead of names`, t`World Info Presets`);
        }
    }

    return migrated;
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
    const isGroupChat = !!selected_group;
    let characterName = null;
    let groupId = null;
    let groupName = null;
    let chatId = chat_metadata?.file_name || null;

    if (isGroupChat) {
        // For group chats, get group-specific information
        groupId = selected_group;
        const group = groups?.find(x => x.id === groupId);
        if (group) {
            groupName = group.name;
            // Use group's chat_id if available, fallback to metadata file_name
            chatId = group.chat_id || chatId;
        }
        // Don't set characterName for groups
    } else {
        // For single character chats, get character name
        characterName = getCharacterNameForSettings();
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

function getGroupLock(groupId) {
    if (!groupId) return null;
    return settings.groupLocks[groupId] || null;
}

function setGroupLock(groupId, presetName) {
    if (!groupId) return;
    if (presetName) {
        settings.groupLocks[groupId] = presetName;
    } else {
        delete settings.groupLocks[groupId];
    }
    saveSettingsDebounced();
}

function getLockForContext() {
    const context = getCurrentContext();
    const chatLock = settings.enableChatLocks ? getChatLock() : null;

    let contextLock = null;
    if (context.isGroupChat) {
        contextLock = settings.enableGroupLocks ? getGroupLock(context.groupId) : null;
    } else {
        contextLock = settings.enableCharacterLocks ? getCharacterLock(context.characterName) : null;
    }

    if (settings.preferChatOverCharacterLocks) {
        return chatLock || contextLock;
    } else {
        return contextLock || chatLock;
    }
}

function getEffectivePreset() {
    // Priority: specific lock > current selection > global default
    const lock = getLockForContext();
    if (lock) {
        return settings.presetList.find(p => p.name === lock);
    }
    
    if (settings.presetName) {
        return settings.preset;
    }
    
    // Fall back to global default if no preset is selected and no locks
    if (settings.globalDefaultPreset) {
        return settings.presetList.find(p => p.name === settings.globalDefaultPreset);
    }
    
    return null;
}

function hasAnyLocks() {
    const context = getCurrentContext();
    const chatLock = settings.enableChatLocks ? getChatLock() : null;

    if (context.isGroupChat) {
        const groupLock = settings.enableGroupLocks ? getGroupLock(context.groupId) : null;
        return !!(chatLock || groupLock);
    } else {
        const characterLock = settings.enableCharacterLocks ? getCharacterLock(context.characterName) : null;
        return !!(chatLock || characterLock);
    }
}

async function checkAndApplyLocks() {
    // Add robustness for cases where character data isn't loaded yet
    let attempts = 0;
    const maxAttempts = 10;
    
    console.log('STWIL: Current settings.presetName:', settings.presetName);
    console.log('STWIL: Global default preset:', settings.globalDefaultPreset);
    
    while (attempts < maxAttempts) {
        const lockedPreset = getLockForContext();
        console.log('STWIL: Locked preset for context:', lockedPreset);
        
        if (lockedPreset) {
            const preset = settings.presetList.find(p => p.name === lockedPreset);
            if (preset) {
                await activatePreset(preset);
                if (settings.showLockNotifications) {
                    const context = getCurrentContext();
                    let lockType = 'character';
                    if (getChatLock()) {
                        lockType = 'chat';
                    } else if (context.isGroupChat) {
                        lockType = 'group';
                    }
                    toastr.info(t`Applied locked preset "${escapeHtml(lockedPreset)}" for ${lockType}`, t`World Info Presets`);
                }
                return; // Success
            } else if (settings.showLockNotifications) {
                toastr.warning(t`Locked preset "${escapeHtml(lockedPreset)}" not found`, t`World Info Presets`);
                return; // Preset not found, don't retry
            }
        }
        
        // If we reach here, either no lock or character data not ready
        const context = getCurrentContext();
        
        if (!context.characterName && !context.chatId) {
            console.log('STWIL: Character/chat data not ready, waiting... attempt', attempts + 1);
            // Wait a bit for data to load
            await new Promise(resolve => setTimeout(resolve, 100));
            attempts++;
            continue;
        }
        
        // Data is available but no locks - apply global default for unlocked characters
        console.log('STWIL: No locks found for this character. Checking if global default should apply.');
        console.log('STWIL: Current presetName:', settings.presetName, 'globalDefault:', settings.globalDefaultPreset);
        
        if (settings.globalDefaultPreset) {
            const defaultPreset = settings.presetList.find(p => p.name === settings.globalDefaultPreset);
            console.log('STWIL: Found default preset:', defaultPreset?.name);
            
            if (defaultPreset) {
                console.log('STWIL: Applying global default preset for unlocked character:', settings.globalDefaultPreset);
                await activatePreset(defaultPreset);
                if (settings.showLockNotifications) {
                    toastr.info(t`Applied global default preset "${escapeHtml(settings.globalDefaultPreset)}" for unlocked character`, t`World Info Presets`);
                }
                return;
            } else {
                console.log('STWIL: Global default preset not found in preset list');
            }
        } else {
            console.log('STWIL: No global default configured');
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
        toastr.warning(t`Preset "${escapeHtml(name)}" not found`);
        return;
    }
    await activatePreset(preset);
};

export const activatePreset = async(preset, skipLockCheck = false)=>{
    // Check if we're changing presets in a locked context
    if (!skipLockCheck && hasAnyLocks()) {
        const currentLock = getLockForContext();
        if (currentLock && preset?.name !== currentLock) {
            const newName = preset?.name || t`None`;
            const content = document.createElement('div');
            content.innerHTML = `
                <h3>${t`Preset Lock Active`}</h3>
                <p>${t`This context is locked to preset "${escapeHtml(currentLock)}" but you're switching to "${escapeHtml(newName)}".`}</p>
                <p>${t`Do you want to update the lock to use the new preset?`}</p>
            `;
            const shouldUpdate = await callPopup(content, 'confirm');
            
            if (shouldUpdate) {
                await updateLocksForContext(preset?.name);
            }
        }
    }
    
    // Use delta approach: only change what's needed instead of brute force
    const currentlyActive = new Set(world_info.globalSelect || []);
    const targetBooks = new Set(preset?.worldList || []);
    
    // Find books to unload (currently active but not in target)
    const booksToUnload = [...currentlyActive].filter(book => !targetBooks.has(book));
    
    // Find books to load (in target but not currently active)
    const booksToLoad = [...targetBooks].filter(book => !currentlyActive.has(book));
    
    // Unload books that shouldn't be active
    for (const book of booksToUnload) {
        await executeSlashCommands(`/world state=off silent=true ${book}`);
    }
    
    // Load books that should be active
    for (const book of booksToLoad) {
        await executeSlashCommands(`/world silent=true ${book}`);
    }

    // Apply world info settings with enhanced reliability
    if (preset?.worldInfoSettings) {
        console.log(`STWIL: Applying world info settings for preset "${preset.name}":`, preset.worldInfoSettings);

        try {
            const settingsResult = await applyWorldInfoEngineSettings(preset.worldInfoSettings);

            if (!settingsResult.success) {
                console.warn(`STWIL: Settings application partially failed for preset "${preset.name}":`, {
                    failed: settingsResult.failedSettings,
                    applied: settingsResult.appliedSettings,
                    attempts: settingsResult.attempt
                });

                if (settings.showLockNotifications && settingsResult.failedSettings.length > 0) {
                    const failedList = settingsResult.failedSettings.join(', ');
                    toastr.warning(
                        t`Some world info settings failed to apply: ${failedList}`,
                        t`World Info Presets`
                    );
                }
            } else {
                console.log(`STWIL: Successfully applied all world info settings for preset "${preset.name}"`);
            }
        } catch (error) {
            console.error(`STWIL: Error applying world info settings for preset "${preset.name}":`, error);
            if (settings.showLockNotifications) {
                toastr.error(t`Failed to apply world info settings for preset "${escapeHtml(preset.name)}"`, t`World Info Presets`);
            }
        }
    }
    
    // Update internal state
    settings.presetName = preset?.name ?? '';
    updateSelect();
    updateLockButton();
    saveSettingsDebounced();
};


function updateLocksForContext(presetName) {
    const context = getCurrentContext();

    if (getChatLock()) {
        setChatLock(presetName);
    }

    if (context.isGroupChat) {
        if (getGroupLock(context.groupId)) {
            setGroupLock(context.groupId, presetName);
        }
    } else {
        if (getCharacterLock(context.characterName)) {
            setCharacterLock(context.characterName, presetName);
        }
    }
}

const updateSelect = ()=>{
    if (!presetSelect) return; // Guard against race condition

    // Update the blank option to show global default
    const blankOption = presetSelect.children[0];
    if (blankOption && blankOption.value === '') {
        blankOption.textContent = settings.globalDefaultPreset ?
            t`--- Default: ${settings.globalDefaultPreset} ---` :
            t`--- Pick a Preset ---`;
    }

    // Get all option elements (excluding the blank option)
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
        update.opt.title = generatePresetTooltip(update.preset);
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
            opt.title = generatePresetTooltip(preset);
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

    let contextLockHtml = '';
    let currentContextLock = false;

    if (context.isGroupChat) {
        const groupLock = getGroupLock(context.groupId);
        currentContextLock = groupLock;
        contextLockHtml = `
            <label class="checkbox_label">
                <input type="checkbox" id="groupLockCheckbox" ${groupLock ? 'checked' : ''}>
                <span>${t`Lock to group`}${context.groupName ? ` (${escapeHtml(context.groupName)})` : ''}</span>
            </label>
        `;
    } else {
        const characterLock = getCharacterLock(context.characterName);
        currentContextLock = characterLock;
        contextLockHtml = `
            <label class="checkbox_label">
                <input type="checkbox" id="characterLockCheckbox" ${characterLock ? 'checked' : ''}>
                <span>${t`Lock to character`}${context.characterName ? ` (${escapeHtml(context.characterName)})` : ''}</span>
            </label>
        `;
    }

    const content = document.createElement('div');
    const presetNameHtml = settings.presetName || t`None`;
    content.innerHTML = `
        <h3>${t`Preset Locks`}</h3>
        <p>${t`Lock the current preset "${escapeHtml(presetNameHtml)}" to this context:`}</p>
        <div>
            ${contextLockHtml}
            <label class="checkbox_label">
                <input type="checkbox" id="chatLockCheckbox" ${chatLock ? 'checked' : ''}>
                <span>${t`Lock to chat`}</span>
            </label>
        </div>
    `;

    const result = await callPopup(content, 'confirm');

    if (result) {
        const chatLockChecked = content.querySelector('#chatLockCheckbox')?.checked || false;

        // Update chat lock
        setChatLock(chatLockChecked ? settings.presetName : null);

        // Update context-specific lock (group or character)
        if (context.isGroupChat) {
            const groupLockChecked = content.querySelector('#groupLockCheckbox')?.checked || false;
            setGroupLock(context.groupId, groupLockChecked ? settings.presetName : null);
        } else {
            const characterLockChecked = content.querySelector('#characterLockCheckbox')?.checked || false;
            if (context.characterName) {
                setCharacterLock(context.characterName, characterLockChecked ? settings.presetName : null);
            }
        }

        updateLockButton();

        if (settings.showLockNotifications) {
            const locks = [];
            if (chatLockChecked) locks.push(t`chat`);

            if (context.isGroupChat) {
                const groupLockChecked = content.querySelector('#groupLockCheckbox')?.checked || false;
                if (groupLockChecked) locks.push(t`group`);
            } else {
                const characterLockChecked = content.querySelector('#characterLockCheckbox')?.checked || false;
                if (characterLockChecked) locks.push(t`character`);
            }

            if (locks.length > 0) {
                const locksText = locks.join(', ');
                toastr.success(t`Preset "${escapeHtml(settings.presetName)}" locked to ${locksText}`, t`World Info Presets`);
            } else {
                toastr.info(t`All locks removed`, t`World Info Presets`);
            }
        }
    }
}

async function showSettings() {
    const content = document.createElement('div');
    
    // Generate options for global default preset
    const presetOptions = settings.presetList
        .map(preset => `<option value="${escapeHtml(preset.name)}" ${preset.name === settings.globalDefaultPreset ? 'selected' : ''}>${escapeHtml(preset.name)}</option>`)
        .join('');
    
    content.innerHTML = `
        <h3>${t`World Info Preset Settings`}</h3>
        <div>
            <div class="marginBot10">
                <h4 class="marginBot5">${t`Global Default Preset:`}</h4>
                <select id="globalDefaultPreset">
                    <option value="">${t`None`}</option>
                    ${presetOptions}
                </select>
                <small style="color: var(--grey50);">${t`This preset will be applied when no specific preset is selected and no locks are active.`}</small>
            </div>
            <hr class="marginTopBot5">
            <label class="checkbox_label">
                <input type="checkbox" id="enableCharacterLocks" ${settings.enableCharacterLocks ? 'checked' : ''}>
                <span>${t`Enable character locks`}</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="enableGroupLocks" ${settings.enableGroupLocks ? 'checked' : ''}>
                <span>${t`Enable group locks`}</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="enableChatLocks" ${settings.enableChatLocks ? 'checked' : ''}>
                <span>${t`Enable chat locks`}</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="preferChatOverCharacterLocks" ${settings.preferChatOverCharacterLocks ? 'checked' : ''}>
                <span>${t`Prefer chat locks over character/group locks`}</span>
            </label>
            <label class="checkbox_label">
                <input type="checkbox" id="showLockNotifications" ${settings.showLockNotifications ? 'checked' : ''}>
                <span>${t`Show lock notifications`}</span>
            </label>
        </div>
    `;
    
    const result = await callPopup(content, 'confirm');
    
    if (result) {
        const newGlobalDefault = content.querySelector('#globalDefaultPreset')?.value || '';
        const oldGlobalDefault = settings.globalDefaultPreset;
        
        settings.globalDefaultPreset = newGlobalDefault;
        settings.enableCharacterLocks = content.querySelector('#enableCharacterLocks')?.checked || false;
        settings.enableGroupLocks = content.querySelector('#enableGroupLocks')?.checked || false;
        settings.enableChatLocks = content.querySelector('#enableChatLocks')?.checked || false;
        settings.preferChatOverCharacterLocks = content.querySelector('#preferChatOverCharacterLocks')?.checked || false;
        settings.showLockNotifications = content.querySelector('#showLockNotifications')?.checked || false;

        saveSettingsDebounced();

        // If global default changed and we're in a context with no locks and no preset, apply the new default
        if (newGlobalDefault !== oldGlobalDefault && !settings.presetName && !hasAnyLocks()) {
            checkAndApplyLocks();
        }
    }
}

/**
 * Safely apply World Info engine settings without touching world_info or world_names.
 * - Only applies fields you provide.
 * - Uses existing UI bindings (input/change events), so values persist and UI stays in sync.
 * - Does NOT call setWorldInfoSettings, so it won't reset world_info or world_names.
 * - Enhanced with retry mechanism and direct fallback for reliability.
 *
 * Note: If you set both world_info_min_activations and world_info_max_recursion_steps to non-zero,
 * the built-in logic will zero the other. This function applies max_recursion_steps first and then
 * min_activations, so min_activations takes precedence if both are > 0.
 *
 * @param {Object} opts
 * @param {number} [opts.world_info_depth]
 * @param {number} [opts.world_info_min_activations]
 * @param {number} [opts.world_info_min_activations_depth_max]
 * @param {number} [opts.world_info_budget]
 * @param {boolean} [opts.world_info_include_names]
 * @param {boolean} [opts.world_info_recursive]
 * @param {boolean} [opts.world_info_overflow_alert]
 * @param {boolean} [opts.world_info_case_sensitive]
 * @param {boolean} [opts.world_info_match_whole_words]
 * @param {number} [opts.world_info_character_strategy] // 0 evenly, 1 character_first, 2 global_first
 * @param {number} [opts.world_info_budget_cap]
 * @param {boolean} [opts.world_info_use_group_scoring]
 * @param {number} [opts.world_info_max_recursion_steps]
 * @param {boolean} [retryOnFailure=true] - Whether to retry on validation failure
 * @param {number} [maxRetries=2] - Maximum retry attempts
 * @returns {Promise<{success: boolean, appliedSettings: Array, failedSettings: Array}>}
 */
export async function applyWorldInfoEngineSettings(opts = {}, retryOnFailure = true, maxRetries = 2) {
    const has = (k) => Object.prototype.hasOwnProperty.call(opts, k);

    const setNumberInputWithFallback = async (selector, value, key) => {
        const $el = $(selector);
        if ($el.length) {
            try {
                $el.val(String(Number(value))).trigger('input');
                await new Promise(resolve => setTimeout(resolve, 10));
                return true;
            } catch (error) {
                console.warn(`STWIL: jQuery approach failed for ${key}, trying direct DOM:`, error);
            }
        }

        // Direct DOM fallback
        const el = document.querySelector(selector);
        if (el) {
            try {
                el.value = String(Number(value));
                el.dispatchEvent(new Event('input', { bubbles: true }));
                return true;
            } catch (error) {
                console.error(`STWIL: Direct DOM approach also failed for ${key}:`, error);
            }
        }
        return false;
    };

    const setCheckboxInputWithFallback = async (selector, value, eventType, key) => {
        const $el = $(selector);
        if ($el.length) {
            try {
                $el.prop('checked', Boolean(value)).trigger(eventType);
                await new Promise(resolve => setTimeout(resolve, 10));
                return true;
            } catch (error) {
                console.warn(`STWIL: jQuery approach failed for ${key}, trying direct DOM:`, error);
            }
        }

        // Direct DOM fallback
        const el = document.querySelector(selector);
        if (el) {
            try {
                el.checked = Boolean(value);
                el.dispatchEvent(new Event(eventType, { bubbles: true }));
                return true;
            } catch (error) {
                console.error(`STWIL: Direct DOM approach also failed for ${key}:`, error);
            }
        }
        return false;
    };

    const setSelectChangeWithFallback = async (selector, value, key) => {
        const $el = $(selector);
        if ($el.length) {
            try {
                $el.val(String(value)).trigger('change');
                await new Promise(resolve => setTimeout(resolve, 10));
                return true;
            } catch (error) {
                console.warn(`STWIL: jQuery approach failed for ${key}, trying direct DOM:`, error);
            }
        }

        // Direct DOM fallback
        const el = document.querySelector(selector);
        if (el) {
            try {
                el.value = String(value);
                el.dispatchEvent(new Event('change', { bubbles: true }));
                return true;
            } catch (error) {
                console.error(`STWIL: Direct DOM approach also failed for ${key}:`, error);
            }
        }
        return false;
    };

    // Apply all settings and track results
    const applyAllSettings = async () => {
        const results = [];

        // Numbers (simple)
        if (has('world_info_depth')) results.push({ key: 'world_info_depth', success: await setNumberInputWithFallback('#world_info_depth', opts.world_info_depth, 'world_info_depth') });
        if (has('world_info_min_activations_depth_max')) results.push({ key: 'world_info_min_activations_depth_max', success: await setNumberInputWithFallback('#world_info_min_activations_depth_max', opts.world_info_min_activations_depth_max, 'world_info_min_activations_depth_max') });
        if (has('world_info_budget')) results.push({ key: 'world_info_budget', success: await setNumberInputWithFallback('#world_info_budget', opts.world_info_budget, 'world_info_budget') });
        if (has('world_info_budget_cap')) results.push({ key: 'world_info_budget_cap', success: await setNumberInputWithFallback('#world_info_budget_cap', opts.world_info_budget_cap, 'world_info_budget_cap') });

        // Booleans (checkboxes)
        if (has('world_info_include_names')) results.push({ key: 'world_info_include_names', success: await setCheckboxInputWithFallback('#world_info_include_names', opts.world_info_include_names, 'input', 'world_info_include_names') });
        if (has('world_info_recursive')) results.push({ key: 'world_info_recursive', success: await setCheckboxInputWithFallback('#world_info_recursive', opts.world_info_recursive, 'input', 'world_info_recursive') });
        if (has('world_info_case_sensitive')) results.push({ key: 'world_info_case_sensitive', success: await setCheckboxInputWithFallback('#world_info_case_sensitive', opts.world_info_case_sensitive, 'input', 'world_info_case_sensitive') });
        if (has('world_info_match_whole_words')) results.push({ key: 'world_info_match_whole_words', success: await setCheckboxInputWithFallback('#world_info_match_whole_words', opts.world_info_match_whole_words, 'input', 'world_info_match_whole_words') });

        // Selects / change-bound booleans
        if (has('world_info_character_strategy')) results.push({ key: 'world_info_character_strategy', success: await setSelectChangeWithFallback('#world_info_character_strategy', opts.world_info_character_strategy, 'world_info_character_strategy') });
        if (has('world_info_overflow_alert')) results.push({ key: 'world_info_overflow_alert', success: await setCheckboxInputWithFallback('#world_info_overflow_alert', opts.world_info_overflow_alert, 'change', 'world_info_overflow_alert') });
        if (has('world_info_use_group_scoring')) results.push({ key: 'world_info_use_group_scoring', success: await setCheckboxInputWithFallback('#world_info_use_group_scoring', opts.world_info_use_group_scoring, 'change', 'world_info_use_group_scoring') });

        // Order matters due to built-in mutual exclusivity:
        // Apply max_recursion_steps first, then min_activations so min_activations "wins" if both are > 0.
        if (has('world_info_max_recursion_steps')) results.push({ key: 'world_info_max_recursion_steps', success: await setNumberInputWithFallback('#world_info_max_recursion_steps', opts.world_info_max_recursion_steps, 'world_info_max_recursion_steps') });
        if (has('world_info_min_activations')) results.push({ key: 'world_info_min_activations', success: await setNumberInputWithFallback('#world_info_min_activations', opts.world_info_min_activations, 'world_info_min_activations') });

        return results;
    };

    // Initial application attempt
    const applicationResults = await applyAllSettings();
    const failedApplications = applicationResults.filter(r => !r.success).map(r => r.key);

    if (failedApplications.length > 0) {
        console.warn('STWIL: Some settings failed to apply via UI:', failedApplications);
    }

    // Validate and retry if necessary
    let attempt = 0;
    while (retryOnFailure && attempt < maxRetries) {
        // Wait for UI to settle
        await new Promise(resolve => setTimeout(resolve, 100));

        const validation = validateSettingsApplied(opts, 'STWIL-Apply');
        if (validation.success) {
            console.log(`STWIL: Settings application successful on attempt ${attempt + 1}`);
            return {
                success: true,
                appliedSettings: applicationResults.filter(r => r.success).map(r => r.key),
                failedSettings: [],
                attempt: attempt + 1
            };
        }

        attempt++;
        if (attempt < maxRetries) {
            console.warn(`STWIL: Settings validation failed, retrying (${attempt + 1}/${maxRetries + 1})...`);
            await applyAllSettings();
        }
    }

    // Final validation
    const finalValidation = validateSettingsApplied(opts, 'STWIL-Final');
    return {
        success: finalValidation.success,
        appliedSettings: applicationResults.filter(r => r.success).map(r => r.key),
        failedSettings: finalValidation.success ? [] : finalValidation.mismatches.map(m => m.key),
        attempt: attempt + 1,
        validationResult: finalValidation
    };
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
        toastr.warning(t`Failed to load World Info book: ${escapeHtml(name)}`);
        return null; // Return null on failure to prevent undefined behavior
    }
};

const importBooks = async(data)=>{
    if (data.books && Object.keys(data.books).length > 0) {
        const content = document.createElement('div');
        content.innerHTML = `<h3>${t`The preset contains World Info books. Import the books?`}</h3>`;
        const doImport = await callPopup(content, 'confirm');
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
        const content = document.createElement('div');
        content.innerHTML = `<h3>${t`The preset contains character locks. Import the character locks?`}</h3>`;
        const doImport = await callPopup(content, 'confirm');
        if (doImport) {
            Object.assign(settings.characterLocks, data.characterLocks);
            saveSettingsDebounced();
        }
    }
};

const importGroupLocks = async(data)=>{
    if (data.groupLocks && Object.keys(data.groupLocks).length > 0) {
        const content = document.createElement('div');
        content.innerHTML = `<h3>${t`The preset contains group locks. Import the group locks?`}</h3>`;
        const doImport = await callPopup(content, 'confirm');
        if (doImport) {
            Object.assign(settings.groupLocks, data.groupLocks);
            saveSettingsDebounced();
        }
    }
};

const importGlobalDefault = async(data, presetName)=>{
    if (data.isGlobalDefault) {
        const content = document.createElement('div');
        content.innerHTML = `<h3>${t`This preset was exported as a global default. Set "${escapeHtml(presetName)}" as your global default?`}</h3>`;
        const doImport = await callPopup(content, 'confirm');
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
            const importNameContent = document.createElement('div');
            importNameContent.innerHTML = `
                <h3>${t`Import World Info Preset: "${escapeHtml(data.name)}"`}</h3>
                <h4>${t`A preset by that name already exists. Change the name to import under a new name, or keep the name to ovewrite the existing preset.`}</h4>
            `;
            const newName = await callPopup(importNameContent, 'input', data.name);
            if (newName == data.name) {
                const overwriteContent = document.createElement('div');
                overwriteContent.innerHTML = `<h3>${t`Overwrite World Info Preset "${escapeHtml(newName)}"?`}</h3>`;
                const overwrite = await callPopup(overwriteContent, 'confirm');
                if (overwrite) {
                    old.worldList = data.worldList; 
                    old.worldInfoSettings = data.worldInfoSettings ?? null;
                    await importBooks(data);
                    await importCharacterLocks(data);
                    await importGroupLocks(data);
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
        preset.worldInfoSettings = data.worldInfoSettings ?? null;
        settings.presetList.push(preset);
        await importBooks(data);
        await importCharacterLocks(data);
        await importGroupLocks(data);
        await importGlobalDefault(data, preset.name);
        updateSelect();
        saveSettingsDebounced();
    } catch (ex) {
        toastr.error(t`Failed to import "${escapeHtml(file.name)}":\n\n${escapeHtml(ex.message)}`);
    }
};

async function showSettingsSelectionDialog() {
    const categories = getSettingsCategories();
    const allSettings = Object.values(categories).flatMap(cat => cat.settings);

    const content = document.createElement('div');
    // No custom className needed - let ST handle popup content styling
    content.innerHTML = `
        <h3>${t`World Info Settings Inclusion`}</h3>
        <p>${t`OPTIONAL: Choose which global world info settings to include in this preset:`}</p>

        <div class="marginBot10">
            <label class="checkbox_label">
                <input type="checkbox" id="includeSettingsToggle" checked>
                <span><strong>${t`Include world info settings in preset`}</strong></span>
            </label>
            <small class="displayBlock indent20p" style="color: var(--grey50);">
                ${t`When enabled, switching to this preset will also apply the selected global settings.`}
            </small>
        </div>

        <div id="settingsCategories" class="indent20p">

            ${Object.entries(categories).map(([catKey, category]) => `
                <div class="marginBot10" style="border: 1px solid var(--grey30); padding: 10px; border-radius: 5px;">
                    <h5>${category.name}</h5>
                    <label class="checkbox_label">
                        <input type="checkbox" class="categoryToggle" data-category="${catKey}" checked>
                        <span>${t`Include this category`}</span>
                    </label>
                    <p class="marginTopBot5" style="color: var(--grey70); font-size: 0.9em;">${category.description}</p>
                    <div class="indent20p">
                        ${category.settings.map(setting => `
                            <label class="checkbox_label">
                                <input type="checkbox" class="settingCheckbox" data-category="${catKey}" data-setting="${setting}" checked>
                                <span style="font-family: var(--monoFontFamily);">${setting.replace('world_info_', '')}</span>
                            </label>
                        `).join('')}
                    </div>
                </div>
            `).join('')}
        </div>
    `;

    // Add event listeners
    const includeToggle = content.querySelector('#includeSettingsToggle');
    const categoriesDiv = content.querySelector('#settingsCategories');

    includeToggle.addEventListener('change', () => {
        categoriesDiv.style.display = includeToggle.checked ? 'block' : 'none';
    });

    // Category toggle logic
    content.querySelectorAll('.categoryToggle').forEach(catToggle => {
        catToggle.addEventListener('change', () => {
            const category = catToggle.dataset.category;
            const categorySettings = content.querySelectorAll(`[data-category="${category}"].settingCheckbox`);
            categorySettings.forEach(cb => cb.checked = catToggle.checked);
        });
    });

    // Individual setting change logic
    content.querySelectorAll('.settingCheckbox').forEach(settingCb => {
        settingCb.addEventListener('change', () => {
            const category = settingCb.dataset.category;
            const categoryToggle = content.querySelector(`[data-category="${category}"].categoryToggle`);
            const categorySettings = content.querySelectorAll(`[data-category="${category}"].settingCheckbox`);
            const checkedCount = Array.from(categorySettings).filter(cb => cb.checked).length;

            categoryToggle.indeterminate = checkedCount > 0 && checkedCount < categorySettings.length;
            categoryToggle.checked = checkedCount === categorySettings.length;
        });
    });

    const customButtons = [
        {
            text: t`Select All`,
            classes: ['menu_button'],
            action: () => {
                content.querySelectorAll('.categoryToggle, .settingCheckbox').forEach(cb => cb.checked = true);
                // Update indeterminate states after selecting all
                content.querySelectorAll('.categoryToggle').forEach(catToggle => {
                    catToggle.indeterminate = false;
                    catToggle.checked = true;
                });
            }
        },
        {
            text: t`Select None`,
            classes: ['menu_button'],
            action: () => {
                content.querySelectorAll('.categoryToggle, .settingCheckbox').forEach(cb => cb.checked = false);
                // Update indeterminate states after deselecting all
                content.querySelectorAll('.categoryToggle').forEach(catToggle => {
                    catToggle.indeterminate = false;
                    catToggle.checked = false;
                });
            }
        }
    ];

    const popup = new Popup(content, POPUP_TYPE.CONFIRM, '', {
        okButton: t`OK`,
        cancelButton: t`Cancel`,
        customButtons: customButtons,
        allowVerticalScrolling: true
    });

    // Note: OK and Cancel buttons use ST's native styling

    const result = await popup.show();
    if (!result) return null;

    const includeSettings = includeToggle.checked;
    const selectedSettings = includeSettings ?
        Array.from(content.querySelectorAll('.settingCheckbox:checked')).map(cb => cb.dataset.setting) :
        [];

    return {
        includeSettings,
        selectedSettings
    };
}

const createPreset = async()=>{
    const nameContent = document.createElement('div');
    nameContent.innerHTML = `<h3>${t`Preset Name:`}</h3>`;
    const name = await callPopup(nameContent, 'input', settings.presetName);
    if (!name) return;

    // Show settings inclusion dialog
    const settingsToInclude = await showSettingsSelectionDialog();
    if (!settingsToInclude) return; // User cancelled

    const preset = new Preset();
    preset.name = name;
    preset.worldList = [...world_info.globalSelect];

    // Apply settings selection
    if (settingsToInclude.includeSettings) {
        const fullSettings = snapshotWorldInfoSettings();
        const filteredSettings = {};

        for (const [key, value] of Object.entries(fullSettings)) {
            if (settingsToInclude.selectedSettings.includes(key)) {
                filteredSettings[key] = value;
            }
        }

        preset.worldInfoSettings = filteredSettings;
        console.log(`STWIL: Created preset "${name}" with selected settings:`, Object.keys(filteredSettings));
    } else {
        preset.worldInfoSettings = null;
        console.log(`STWIL: Created preset "${name}" without world info settings`);
    }

    settings.presetList.push(preset);
    settings.presetName = name;
    updateSelect();
    updateLockButton();
    saveSettingsDebounced();
};

// Event handlers
function onCharacterChanged() {
    clearContextCache(); // Clear cache when character changes
    updateLockButton();

    // Always check for locks and global defaults, regardless of lock settings
    setTimeout(() => {
        checkAndApplyLocks();
    }, 100);
}

function onChatChanged() {
    clearContextCache(); // Clear cache when chat changes
    updateLockButton();
    setTimeout(() => {
        checkAndApplyLocks();
    }, 100);
}

const init = ()=>{
    const container = document.querySelector('#WorldInfo > div > h3');
    if (!container) {
        console.warn('STWIL: WorldInfo container not found, retrying in 500ms...');
        setTimeout(init, 500);
        return;
    }

    // Migrate existing presets to include world info settings
    migratePresetsToIncludeSettings();

    // Migrate group locks from character locks storage
    migrateGroupLocksFromCharacterLocks();
    
    const dom = document.createElement('div'); {
        dom.classList.add('flex', 'flexAuto', 'flexFlowRow', 'alignItemsBaseline');
        dom.style.gap = '1em';
        dom.style.marginRight = '1em';
        dom.style.opacity = '0.25';
        dom.style.filter = 'saturate(0.5)';
        dom.style.transition = '200ms';
        dom.addEventListener('mouseenter', () => {
            dom.style.opacity = '1';
            dom.style.filter = 'saturate(1.0)';
        });
        dom.addEventListener('mouseleave', () => {
            dom.style.opacity = '0.25';
            dom.style.filter = 'saturate(0.5)';
        });
        presetSelect = document.createElement('select'); {
            const blank = document.createElement('option'); {
                blank.value = '';
                blank.textContent = settings.globalDefaultPreset ? 
                    t`--- Default: ${settings.globalDefaultPreset} ---` : 
                    t`--- Pick a Preset ---`;
                presetSelect.append(blank);
            }
            for (const preset of settings.presetList.toSorted((a,b)=>a.name.toLowerCase().localeCompare(b.name.toLowerCase()))) {
                const opt = document.createElement('option'); {
                    opt.value = preset.name;
                    opt.textContent = preset.name;
                    opt.title = generatePresetTooltip(preset);
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
                                toastr.info(t`Applied global default preset "${escapeHtml(settings.globalDefaultPreset)}"`, t`World Info Presets`);
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
            actions.classList.add('flex', 'flexFlowRow');
            actions.style.gap = '0.25em';
            
            // Lock button
            lockButton = document.createElement('div'); {
                lockButton.classList.add('menu_button', 'fa-solid', 'fa-lock');
                lockButton.title = t`Preset locks`;
                lockButton.addEventListener('click', showLockSettings);
                actions.append(lockButton);
            }
            
            // Settings button
            settingsButton = document.createElement('div'); {
                settingsButton.classList.add('menu_button', 'fa-solid', 'fa-gear');
                settingsButton.title = t`Settings`;
                settingsButton.addEventListener('click', showSettings);
                actions.append(settingsButton);
            }
            
            const btnRename = document.createElement('div'); {
                btnRename.classList.add('menu_button', 'fa-solid', 'fa-pencil');
                btnRename.title = t`Rename current preset`;
                btnRename.addEventListener('click', async()=>{
                    const oldName = settings.presetName;
                    const renameContent = document.createElement('div');
                    renameContent.innerHTML = `<h3>${t`Rename Preset:`}</h3>`;
                    const name = await callPopup(renameContent, 'input', settings.presetName);
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

                    // Update group locks that reference this preset
                    for (const [groupId, lockedPreset] of Object.entries(settings.groupLocks)) {
                        if (lockedPreset === oldName) {
                            settings.groupLocks[groupId] = name;
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
                btnUpdate.classList.add('menu_button', 'fa-solid', 'fa-save');
                btnUpdate.title = t`Update current preset`;
                btnUpdate.addEventListener('click', ()=>{
                    if (!settings.preset) return createPreset();
                    settings.preset.worldList = [...world_info.globalSelect];
                    settings.preset.worldInfoSettings = snapshotWorldInfoSettings();
                    saveSettingsDebounced();
                });
                actions.append(btnUpdate);
            }
            const btnCreate = document.createElement('div'); {
                btnCreate.classList.add('menu_button', 'fa-solid', 'fa-file-circle-plus');
                btnCreate.title = t`Save current preset as`;
                btnCreate.addEventListener('click', async()=>createPreset());
                actions.append(btnCreate);
            }
            const btnRestore = document.createElement('div'); {
                btnRestore.classList.add('menu_button', 'fa-solid', 'fa-rotate-left');
                btnRestore.title = t`Restore current preset`;
                btnRestore.addEventListener('click', ()=>activatePreset(settings.preset, true));
                actions.append(btnRestore);
            }
            const importFile = document.createElement('input'); {
                importFile.type = 'file';
                importFile.addEventListener('change', async()=>{
                    await importPreset(importFile.files);
                    importFile.value = null;
                });
            }
            const btnImport = document.createElement('div'); {
                btnImport.classList.add('menu_button', 'fa-solid', 'fa-file-import');
                btnImport.title = t`Import preset`;
                btnImport.addEventListener('click', ()=>importFile.click());
                actions.append(btnImport);
            }
            const btnExport = document.createElement('div'); {
                btnExport.classList.add('menu_button', 'fa-solid', 'fa-file-export');
                btnExport.title = t`Export the current preset`;
                btnExport.addEventListener('click', async () => {
                    if (!settings.preset) {
                        toastr.warning(t`No preset selected to export`);
                        return;
                    }

                    // Create a container element for the popup's content
                    const content = document.createElement('div');
                    content.innerHTML = `
                        <h3>${t`Export World Info Preset: "${escapeHtml(settings.presetName)}"`}</h3>
                        <div>
                            <label class="checkbox_label">
                                <input type="checkbox" id="includeBooks" checked>
                                <span>${t`Include books' contents in export`}</span>
                            </label>
                            <label class="checkbox_label">
                                <input type="checkbox" id="useCurrentSelection">
                                <span>${t`Use currently selected books instead of preset definition`}</span>
                            </label>
                        </div>
                        <p><small>${t`By default, exports the preset's defined book list. Check the second option to export your current working selection instead.`}</small></p>
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

                    // Include group locks in export
                    const relevantGroupLocks = {};
                    for (const [groupId, lockedPreset] of Object.entries(settings.groupLocks)) {
                        if (lockedPreset === settings.presetName) {
                            relevantGroupLocks[groupId] = lockedPreset;
                        }
                    }
                    if (Object.keys(relevantGroupLocks).length > 0) {
                        data.groupLocks = relevantGroupLocks;
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
                btnDelete.classList.add('menu_button', 'redWarningBG', 'fa-solid', 'fa-trash-can');
                btnDelete.title = t`Delete the current preset`;
                btnDelete.addEventListener('click', async()=>{
                    if (settings.presetName == '') return;
                    const deleteContent = document.createElement('div');
                    deleteContent.innerHTML = `<h3>${t`Delete World Info Preset "${escapeHtml(settings.presetName)}"?`}</h3>`;
                    const confirmed = await callPopup(deleteContent, 'confirm');
                    if (confirmed) {
                        const presetName = settings.presetName;
                        
                        // Remove character locks that reference this preset
                        for (const [charName, lockedPreset] of Object.entries(settings.characterLocks)) {
                            if (lockedPreset === presetName) {
                                delete settings.characterLocks[charName];
                            }
                        }

                        // Remove group locks that reference this preset
                        for (const [groupId, lockedPreset] of Object.entries(settings.groupLocks)) {
                            if (lockedPreset === presetName) {
                                delete settings.groupLocks[groupId];
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

    // Event listeners
    if (eventSource && event_types) {
        eventSource.on(event_types.CHARACTER_SELECTED, onCharacterChanged);
        eventSource.on(event_types.CHAT_CHANGED, onChatChanged);
        eventSource.on(event_types.CHAT_LOADED, () => {
            clearContextCache(); // Clear cache when chat loads
            setTimeout(() => {
                updateLockButton();
                updateSelect(); // Update dropdown filtering for new context
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
                        <h3>${t`World Info Renamed`}</h3>
                        <p>${t`It looks like you renamed the World Info book "${escapeHtml(oldName)}" to "${escapeHtml(newName)}".`}</p>
                        <p>${t`The following presets currently include the World Info book "${escapeHtml(oldName)}":`}</p>
                        <ul>
                            ${presets.map(it=>`<li>${escapeHtml(it.name)}</li>`).join('')}
                        </ul>
                        <p>
                            ${t`Do you want to update all ${presets.length} presets that include`} "<strong>${escapeHtml(oldName)}</strong>" ${t`to now include`} "<strong>${escapeHtml(newName)}</strong>" ${t`instead?`}
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
    t`<span class="monospace">(optional preset name)</span> – Activate a World Info preset. Leave name blank to deactivate current preset (unload all WI books).`,
    true,
    true,
);
