# Changelog

All notable changes to this project will be documented in this file.

## [1.10.5] - 2025-11-05

### Fixed
- **Crash on unnamed/blank preset**: Fixed bug where presets with no name crash on load. (Thank you @deliss__ for locating the bug and providing code to fix!)

## [1.10.4] - 2025-10-01

### Security
- **XSS Prevention**: Added proper HTML escaping for all user-controlled inputs to prevent cross-site scripting attacks
  - Imported `escapeHtml` utility from SillyTavern's utils.js
  - Sanitized preset names, character names, group names, and book names in all UI dialogs
  - Sanitized user input in toast notifications and error messages
  - Applied escaping to all innerHTML assignments containing dynamic content

## [1.10.3] - 2025-09-30

### Fixed
- **Chat locks unchecking character locks**: Fixed bug where unchecking chat locks also disabled character locks.

## [1.10.2] - 2025-09-22

### Changed
- **CSS Architecture**: Removed custom CSS file and migrated all styling to use SillyTavern's native CSS classes for better consistency and maintainability
- **Code Quality**: Consolidated classList.add() calls to follow DRY principle and improve code readability

### Fixed
- **Extension Loading**: Fixed manifest.json to properly load extension without custom CSS dependency

## [1.10.1] - 2025-09-21

### Fixed
- **Settings Selection Dialog Scrolling**: Added vertical scrolling support to the World Info settings selection dialog that appears when saving presets, allowing users to scroll through all available settings options

## [1.10.0] - 2025-09-17

### Fixed
- **Activation Popup Button Styling**: Fixed "whited out" appearance of buttons in the activation popup that occurs when choosing "Save Preset As"
  - Removed problematic `filter: grayscale(0.5)` effect from custom buttons
  - Implemented proper custom button styling using SillyTavern's CSS variables (`--crimson70a`, `--active`, `--SmartThemeBlurTintColor`, etc.)
  - Converted activation dialog to use SillyTavern's custom button system for better integration
  - Added properly colored "Select All" and "Select None" action buttons with green accent styling
  - OK and Cancel buttons now use proper crimson and standard theming respectively

### Changed
- Moved Select All/Select None buttons from inline HTML to popup's custom button system for better UX and styling consistency

## [1.9.0] - 2025-09-16

### Added
- **Comprehensive World Info Settings Support**: Presets can now optionally capture and restore all major World Info configuration settings including:
  - Activation settings (`world_info_depth`, `world_info_min_activations`, `world_info_min_activations_depth_max`)
  - Budget settings (`world_info_budget`, `world_info_budget_cap`, `world_info_overflow_alert`)
  - Behavior settings (`world_info_recursive`, `world_info_max_recursion_steps`)
  - Matching settings (`world_info_case_sensitive`, `world_info_match_whole_words`, `world_info_include_names`)
  - Strategy settings (`world_info_character_strategy`, `world_info_use_group_scoring`)
  - Note: These settings are optional and don't need to be saved with every preset
- Enhanced group chat support - character locks now work in group chats

### Changed
- Group chat UI now shows "Lock to group" instead of "Lock to character" for better clarity
- Removed restriction that disabled character locks in group chats
- Settings are now organized into logical categories (Activation, Budget, Behavior, Matching, Strategy) in the UI

## [1.8.0] - 2025-06-01

### Added
- Basic preset functionality improvements

## [1.7.0] and earlier

Historical versions - see git history for details.

---

**Note:** This changelog was created retroactively. For complete version history prior to 1.8.0, please refer to the git commit history.