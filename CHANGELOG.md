# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.8.1] - 2025-01-16

### Changed
- Improved code maintainability by replacing inline CSS with SillyTavern utility classes
- Enhanced semantic HTML structure with proper heading hierarchy
- Replaced hardcoded colors with CSS variables for better theme consistency
- Updated UI text for better clarity ("Include this category" instead of category name in checkboxes)

### Technical
- Reduced inline styles from 16 to 6 instances (62.5% reduction)
- Now uses ST's utility classes: `.marginBot10`, `.marginBot5`, `.indent20p`, `.margin-right-10px`, `.marginTopBot5`, `.displayBlock`
- Replaced hardcoded colors (`#888`, `#aaa`, `#444`) with CSS variables (`var(--grey50)`, `var(--grey70)`, `var(--grey30)`)
- Improved semantic HTML by converting styled labels to proper headings (`<h4>`, `<h5>`)
- Better monospace font consistency using `var(--monoFontFamily)`

## [1.8.0] - 2025-01-16

### Added
- Initial CSS and HTML structure improvements

## [1.7.0] and earlier

Historical versions - see git history for details.

---

**Note:** This changelog was created retroactively. For complete version history prior to 1.8.0, please refer to the git commit history.