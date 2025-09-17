# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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