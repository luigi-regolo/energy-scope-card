# Energy Scope Card

[![TikTok | Segui](assets/tiktok-segui.svg)](https://www.tiktok.com/@luigi.regolo)
[![License: GPL-3.0-only](https://img.shields.io/badge/license-GPL--3.0--only-blue?style=flat-square)](LICENSE)
[![HACS Repository](https://img.shields.io/badge/HACS-Repository-41BDF5?style=flat-square)](https://my.home-assistant.io/redirect/hacs_repository/?owner=luigi-regolo&repository=energy-scope-card&category=plugin)
[![GitHub Stars](https://img.shields.io/github/stars/luigi-regolo/energy-scope-card?style=flat-square)](https://github.com/luigi-regolo/energy-scope-card/stargazers)

## Overview

**Energy Scope Card** is a modern, minimalist, and responsive energy monitoring card for Home Assistant, inspired by the Edera Light and Graphite Dark visual styles.

It provides energy consumption monitoring, daily charts, monthly comparisons, and yearly statistics through an elegant dashboard interface.

The card supports compatible monthly energy meters and cumulative energy sensors, allowing users to monitor individual circuits and whole-home electricity consumption.

Energy Scope Card uses Home Assistant entities and available local Recorder statistics. No dedicated account, paid API, subscription, or external JavaScript library is required.

## Preview

<!-- Preview image will be added after testing. -->

## Features

- **Energy monitoring:** Display current monthly energy consumption in kWh.
- **Previous month:** Show the previous month's consumption when available.
- **Monthly comparisons:** Calculate percentage changes using equivalent completed calendar days.
- **Daily charts:** Visualize daily energy consumption and compare it with the previous month.
- **Yearly statistics:** Display monthly consumption throughout the year using available historical statistics.
- **Instantaneous power:** Optionally display current power consumption in watts.
- **Multiple energy sources:** Switch between separately configured energy sources, such as individual circuits and whole-home consumption.
- **Flexible sensors:** Support compatible monthly-reset energy meters and cumulative energy counters.
- **Detailed statistics:** Open a compact popup with additional energy information.
- **Visual editor:** Configure energy sensors, optional power sensors, charts, labels, and appearance directly in Home Assistant.
- **Edera appearance:** Automatic, Light, and Graphite Dark display modes.
- **Responsive design:** Adaptive layout for desktop, tablet, and smartphone dashboards.
- **Read-only monitoring:** No commands are sent to electrical devices.

Energy sources remain separate to avoid double counting. Missing historical values are not estimated, and comparisons are displayed only when sufficient data is available.

## Installation

### HACS

[![Open Energy Scope Card in HACS](https://my.home-assistant.io/badges/hacs_repository.svg)](https://my.home-assistant.io/redirect/hacs_repository/?owner=luigi-regolo&repository=energy-scope-card&category=plugin)

1. Open **Energy Scope Card** in HACS using the link above.
2. Follow the available prompts and download the card through HACS.
3. Reload the Home Assistant dashboard if necessary.
4. Add **Energy Scope Card** to your dashboard.
5. Configure the card using the visual editor.

## Configuration / Usage

### Visual Editor

The card provides four configuration sections:

- **Sources:** Select energy sensors, optional power sensors, source names, and an additional whole-home energy source.
- **Charts:** Configure monthly charts, yearly statistics, percentage comparisons, and detailed information.
- **Appearance:** Customize the title, upper heading, and Edera display mode.
- **Advanced:** Configure numerical precision.

No YAML configuration is required for normal setup.

### Energy Calculations

For compatible monthly-reset meters, the current period is read directly from the sensor, while the previous period is obtained from its available attributes.

For cumulative energy sensors, period consumption is calculated using Home Assistant Recorder statistics.

Daily comparisons use equivalent completed calendar days. Yearly statistics depend on the historical data actually stored by Home Assistant.

Unavailable statistics are not replaced with estimated consumption values.

### Whole-Home Monitoring

A compatible whole-home electricity meter can be configured as an additional energy source.

The card can display its energy consumption and optional instantaneous power without combining those measurements with existing individual circuit totals.

## Compatibility / Requirements

Energy Scope Card requires Home Assistant with support for custom JavaScript dashboard cards and compatible energy sensors.

Supported energy sensors must provide:

- `device_class: energy`
- `state_class: total` or `total_increasing`
- Energy units: Wh, kWh, or MWh

Optional power sensors must provide `device_class: power` with W or kW units.

Historical charts and comparisons require suitable Recorder statistics. Their availability depends on the sensor's recorded history.

No specific minimum Home Assistant version has been independently verified.

The card does not require the Edera theme, an external cloud service, or additional frontend libraries.

## Copyright & License

Copyright © 2026 luigi-regolo

Original project created and maintained by luigi-regolo.

Licensed under the **GNU General Public License, version 3 only (GPL-3.0-only)**. See [LICENSE](LICENSE) for the complete license terms.
