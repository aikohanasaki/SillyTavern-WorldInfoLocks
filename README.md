# World Info Locks (A SillyTavern Extension)

![Status: Feature Complete](https://img.shields.io/badge/Status-Feature%20Complete-brightgreen)
![Maintenance: Active](https://img.shields.io/badge/Maintenance-Active-blue)

World Info Locks is a comprehensive preset management system for SillyTavern's World Info functionality. Originally forked from [World Info Presets](https://github.com/LenAnderson/SillyTavern-WorldInfoPresets/), it has evolved into a powerful tool for managing lorebook configurations across different contexts.

> **📋 Project Status**: This extension is considered feature-complete and stable as of version 1.6.0. While major new features are not planned, bug reports and compatibility updates are welcome!

## 🌟 Key Features

### 📚 **World Info Presets**
- **Save and Load Presets**: Create named presets that include both world info books and global settings
- **Smart Book Management**: Automatically handles loading/unloading of multiple world info books
- **Settings Preservation**: Captures and restores all world info configuration settings
- **CharLore Protection**: Intelligently preserves character-specific lore data when switching presets

### 🔒 **Advanced Locking System**
- **Character Locks**: Lock specific presets to individual characters
- **Chat Locks**: Lock presets to specific conversations
- **Lock Priority**: Configure whether chat locks or character locks take precedence
- **Group Chat Support**: Handles group conversations appropriately (character locks disabled, chat locks available)

### 🌍 **Global Defaults**
- **Global Default Preset**: Set a fallback preset for unlocked characters/chats
- **Automatic Application**: Seamlessly applies appropriate presets based on context
- **Smart Notifications**: Optional toast notifications for preset changes

### 📤 **Import/Export System**
- **Complete Preset Export**: Export presets with all associated world info books
- **Character Lock Export**: Include character-specific lock configurations
- **Global Default Export**: Mark and restore global default settings
- **Flexible Import Options**: Choose to include books, overwrite existing presets, etc.

### 🔧 **Intelligent Management**
- **Book Rename Detection**: Automatically updates presets when world info books are renamed
- **Conflict Resolution**: Smart handling of preset name conflicts during import
- **Live Updates**: Real-time UI updates when switching contexts
- **Caching System**: Optimized performance with intelligent context caching

## 🚀 Installation

1. Download or clone this repository into your SillyTavern extensions folder:
   ```
   [SillyTavern]/public/scripts/extensions/SillyTavern-WorldInfoLocks/
   ```

2. Restart SillyTavern or reload the page

3. The extension will appear in your World Info panel with a dropdown and action buttons

## 📖 Usage Guide

### Creating Your First Preset

1. **Set up your World Info**: Select the world info books and configure settings as desired
2. **Create Preset**: Click the ➕ button and give your preset a name
3. **Activate Later**: Use the dropdown to switch between presets anytime

### Setting Up Locks

1. **Select a Preset**: Choose the preset you want to lock
2. **Open Lock Settings**: Click the 🔒 button
3. **Choose Lock Type**:
   - ✅ **Lock to character**: Preset automatically applies when chatting with this character
   - ✅ **Lock to chat**: Preset automatically applies when in this specific conversation
4. **Confirm**: Click OK to save your lock settings

### Configuring Global Settings

1. **Open Settings**: Click the ⚙️ button
2. **Set Global Default**: Choose a preset to apply when no locks are active
3. **Configure Lock Behavior**:
   - Enable/disable character locks
   - Enable/disable chat locks
   - Choose lock priority (chat over character or vice versa)
   - Toggle lock notifications

### Import/Export Workflow

**Exporting:**
1. Select the preset to export
2. Click the 📤 Export button
3. Choose options:
   - Include book contents
   - Use current selection instead of preset definition
4. Save the generated JSON file

**Importing:**
1. Click the 📥 Import button
2. Select your preset JSON file(s)
3. Resolve any naming conflicts
4. Choose whether to import included books and character locks

## 🎯 Advanced Features

### Book Rename Detection
When you rename a world info book, the extension detects this change and offers to update all presets that reference the old name to use the new name instead.

### Slash Command Support
Use the `/wipreset` command to quickly switch presets:
```
/wipreset MyPresetName
/wipreset  // (blank to deactivate current preset)
```

### Context-Aware Behavior
- **Character Changes**: Automatically applies character-locked presets when switching characters
- **Chat Changes**: Applies chat-locked presets when switching conversations
- **Group Chats**: Adapts behavior appropriately (character locks disabled, uses group name for chat locks)

## ⚙️ Configuration Options

| Setting | Description | Default |
|---------|-------------|---------|
| **Global Default Preset** | Preset to apply when no specific preset is selected and no locks are active | None |
| **Enable Character Locks** | Allow presets to be locked to specific characters | ✅ Enabled |
| **Enable Chat Locks** | Allow presets to be locked to specific chats | ✅ Enabled |
| **Prefer Chat Over Character Locks** | When both exist, prioritize chat locks over character locks | ❌ Disabled |
| **Show Lock Notifications** | Display toast notifications when locked presets are applied | ✅ Enabled |

## 🔄 Migration from World Info Presets

If you're upgrading from the original World Info Presets extension:

1. Your existing presets will be automatically preserved
2. All functionality from the original extension is maintained
3. New locking and global default features are available immediately
4. No manual migration steps required

## 🐛 Troubleshooting

**Preset not applying correctly?**
- Check that all referenced world info books still exist
- Verify lock settings in the 🔒 menu
- Check global default settings in ⚙️ menu

**Character locks not working?**
- Ensure character locks are enabled in settings
- Verify you're not in a group chat (character locks are disabled in group chats)
- Check that the character name matches exactly

**Missing notifications?**
- Enable "Show lock notifications" in the settings menu

## 🤝 Contributing

This extension is considered feature-complete, but contributions are still welcome! Please feel free to:
- **Report bugs** via GitHub issues (actively maintained)
- **Submit compatibility fixes** for SillyTavern updates
- **Improve documentation** and examples
- **Share usage tips** and workflows

> **Note**: While the extension is feature-complete, bug reports and compatibility updates are always appreciated to keep it working smoothly with SillyTavern updates.

## 🙏 Acknowledgments

- Original [World Info Presets](https://github.com/LenAnderson/SillyTavern-WorldInfoPresets/) extension by LenAnderson