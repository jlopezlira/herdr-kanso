#!/usr/bin/env node
// Reads the prototype's Storybook export (sb-atomic-stories.json, sb-atomic.css, sb-atomic-sprite.svg, board-notes.md) from <dir> and writes stories/proto*.
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const CLASSES = {
  "B": "kanso-mascot__pixel--blue",
  "C": "kanso-mascot__pixel--cream",
  "D": "kanso-mascot__pixel--light",
  "F": "kanso-mascot__pixel--fur",
  "K": "kanso-mascot__pixel--eye",
  "N": "kanso-mascot__pixel--nose",
  "O": "kanso-mascot__pixel--outline",
  "T": "kanso-mascot__pixel--accent",
  "a": "kanso-content__primary",
  "act": "kanso-row__activity",
  "acts": "kanso-actions",
  "add": "kanso-diff__line--added",
  "ag": "kanso-agent",
  "ag-l": "kanso-agent__meta",
  "ag-n": "kanso-agent__name",
  "ag-t": "kanso-agent__text",
  "ag-time": "kanso-agent__time",
  "age": "kanso-content__age",
  "annotate": "kanso-simulator__screen--annotating",
  "arm": "kanso-button--armed",
  "artbig": "kanso-dawn--preview",
  "at": "kanso-cell--current",
  "av": "kanso-avatar",
  "av-s": "kanso-avatar--round",
  "av32": "kanso-avatar--large",
  "away": "kanso-activity",
  "away-h": "kanso-activity__header",
  "away-r": "kanso-activity__row",
  "b": "kanso-content__secondary",
  "bad": "kanso-field--invalid",
  "ban": "kanso-picture__banner",
  "bd": "kanso-header__branch",
  "bg": "kanso-prototype__board-content",
  "bh": "kanso-prototype__board-heading",
  "big": "kanso-metric__value",
  "blk": "kanso-row--blocked",
  "board": "kanso-prototype__board",
  "body15": "kanso-prose",
  "brand": "kanso-brand",
  "brx-at": "kanso-tooltip__anchor",
  "brx-body": "kanso-pane__body",
  "brx-caret": "kanso-tab__caret",
  "brx-cell": "kanso-story__bars-cell",
  "brx-cnt": "kanso-search__count",
  "brx-day": "kanso-search__day",
  "brx-dim": "kanso-tab--dim",
  "brx-dimrow": "kanso-menu-item--dim",
  "brx-drop": "kanso-pane--drop-preview",
  "brx-edge": "kanso-edge",
  "brx-edit": "kanso-tab__editor",
  "brx-ex": "kanso-search__excerpt",
  "brx-fbar": "kanso-search__bar",
  "brx-fin": "kanso-search__input",
  "brx-foc": "kanso-pane--focus",
  "brx-fpanel": "kanso-search",
  "brx-frame": "kanso-story__bars-frame",
  "brx-gone": "kanso-toast--removed",
  "brx-held": "kanso-tab--held",
  "brx-hit": "kanso-search__hit",
  "brx-hov": "kanso-tab--hover",
  "brx-ins": "kanso-tab-bar__insertion",
  "brx-lab": "kanso-story__bars-lab",
  "brx-m": "kanso-search__match",
  "brx-mono": "kanso-notification__code",
  "brx-n": "kanso-tab__name",
  "brx-off": "kanso-tab--off",
  "brx-os": "kanso-notification",
  "brx-osi": "kanso-notification__icon",
  "brx-ph": "kanso-search__input--placeholder",
  "brx-real": "kanso-story--real-bars",
  "brx-rel": "kanso-story__bars-anchor",
  "brx-row": "kanso-story__bars-row",
  "brx-ruler": "kanso-pane__drop-ruler",
  "brx-s6": "kanso-status-bar__item--offset",
  "brx-sel": "kanso-tab__selection",
  "brx-sl": "kanso-status-bar__left",
  "brx-slot": "kanso-status-bar__slot",
  "brx-sm": "kanso-status-bar__middle",
  "brx-sp": "kanso-menu-item__spacer",
  "brx-sr": "kanso-status-bar__right",
  "brx-src": "kanso-toast__source",
  "brx-st": "kanso-status-bar--grid",
  "brx-stage": "kanso-story__bars-stage",
  "brx-stand": "kanso-pane__placeholder",
  "brx-stk": "kanso-status-bar__stack",
  "brx-stripv": "kanso-pane-strip",
  "brx-tgrid": "kanso-story__toast-grid",
  "brx-tile": "kanso-minimap__tile",
  "brx-tools": "kanso-tab-bar__tools",
  "brx-top": "kanso-story__bars-label--top",
  "brx-well": "kanso-search__results",
  "brx-who": "kanso-search__author",
  "brx-zone": "kanso-pane__drop-zone",
  "btn": "kanso-button",
  "c": "kanso-content__actions",
  "c-blk": "kanso-text--blocked",
  "c-dim": "kanso-text--dim",
  "c-done": "kanso-text--done",
  "c-fg": "kanso-text--foreground",
  "c-mu": "kanso-text--muted",
  "c-vio": "kanso-text--violet",
  "c-work": "kanso-text--working",
  "cap": "kanso-story__caption",
  "card": "kanso-card",
  "ch": "kanso-card__header",
  "chip": "kanso-chip",
  "ck": "kanso-review__line--checked",
  "cn": "kanso-machine__name",
  "cnt": "kanso-section__count",
  "col": "kanso-story__layout-column",
  "cols": "kanso-settings__columns",
  "comp": "kanso-machine",
  "cost": "kanso-metric__cost",
  "cpill": "kanso-badge--count",
  "cs": "kanso-machine__status",
  "ct": "kanso-status-bar__counts",
  "cta": "kanso-picture__action",
  "ctl": "kanso-button--count",
  "ctl-k": "kanso-prototype__keyboard-control",
  "ctl-t": "kanso-prototype__theme-control",
  "cur": "kanso-control--current",
  "cv": "kanso-row__chevron",
  "d": "kanso-content__description",
  "d-blk": "kanso-dot--blocked",
  "d-done": "kanso-dot--done",
  "d-vio": "kanso-dot--violet",
  "d-work": "kanso-dot--working",
  "dawn": "kanso-dawn",
  "del": "kanso-diff__line--deleted",
  "dg": "kanso-header__digest",
  "dgx-a": "kanso-arrangement__agent",
  "dgx-ahead": "kanso-settings__area-header",
  "dgx-ar": "kanso-settings__area",
  "dgx-arrow": "kanso-dialog__arrow",
  "dgx-ask": "kanso-keyboard__shortcut--recording",
  "dgx-askt": "kanso-keyboard__recording-label",
  "dgx-at": "kanso-dojo__classic-cell--current",
  "dgx-bar": "kanso-markdown__status",
  "dgx-bd": "kanso-keyboard__key--bound",
  "dgx-big": "kanso-dojo__classic-value--large",
  "dgx-body": "kanso-settings__area--body",
  "dgx-bt": "kanso-markdown__status-text",
  "dgx-c": "kanso-dojo__classic-cell",
  "dgx-cap": "kanso-dojo__key-cap",
  "dgx-caps": "kanso-dojo__key-caps",
  "dgx-car": "kanso-dialog__caret",
  "dgx-cells": "kanso-dojo__classic-grid",
  "dgx-ch": "kanso-keyboard__chord",
  "dgx-chip": "kanso-settings__area-chip",
  "dgx-chips": "kanso-settings__area-list",
  "dgx-cmd": "kanso-arrangement__command",
  "dgx-code": "kanso-dojo__code",
  "dgx-col": "kanso-arrangement__column",
  "dgx-cr": "kanso-credit",
  "dgx-cut": "kanso-settings__fade",
  "dgx-d": "kanso-dialog",
  "dgx-dawnn": "kanso-update__timeline-dot--dawn",
  "dgx-dj": "kanso-dojo--classic",
  "dgx-djb": "kanso-dojo__classic-body",
  "dgx-djh": "kanso-dojo__classic-header",
  "dgx-djl": "kanso-dojo__classic-sidebar",
  "dgx-djr": "kanso-dojo__classic-main",
  "dgx-doc": "kanso-markdown__document",
  "dgx-dot": "kanso-update__timeline-dot",
  "dgx-dt": "kanso-update__date",
  "dgx-dt2": "kanso-update__timeline-date",
  "dgx-e": "kanso-dialog__note--error",
  "dgx-fold": "kanso-update__fold",
  "dgx-found": "kanso-settings__results",
  "dgx-ft": "kanso-dialog__footer",
  "dgx-g": "kanso-dialog__group",
  "dgx-gapt": "kanso-dialog__section",
  "dgx-gapt8": "kanso-dialog__subsection",
  "dgx-gh": "kanso-markdown__grid-heading",
  "dgx-go": "kanso-dojo__classic-cell--goal",
  "dgx-gone": "kanso-dialog__missing",
  "dgx-grid": "kanso-markdown__grid",
  "dgx-h": "kanso-dialog__header",
  "dgx-hachi": "kanso-dojo__classic-mascot",
  "dgx-hd": "kanso-keyboard__key--available",
  "dgx-held": "kanso-keyboard__key--held",
  "dgx-here": "kanso-update__timeline-dot--current",
  "dgx-hint": "kanso-keyboard__hint",
  "dgx-hl": "kanso-dialog__highlight",
  "dgx-hlogo": "kanso-dialog__logo",
  "dgx-it": "kanso-update__change",
  "dgx-k": "kanso-keyboard__key",
  "dgx-kb": "kanso-keyboard",
  "dgx-keys": "kanso-keyboard__layout",
  "dgx-kl": "kanso-keyboard__shortcuts",
  "dgx-kr": "kanso-keyboard__row",
  "dgx-kx": "kanso-keyboard__shortcut",
  "dgx-lay": "kanso-keyboard__layout-name",
  "dgx-lb": "kanso-settings__piece-label",
  "dgx-lead": "kanso-credit__avatar",
  "dgx-list": "kanso-dialog__list",
  "dgx-ln": "kanso-dialog__note",
  "dgx-lv": "kanso-dojo__classic-level",
  "dgx-ly": "kanso-keyboard__layer",
  "dgx-map": "kanso-dialog__mapping",
  "dgx-mb": "kanso-markdown__section",
  "dgx-mta": "kanso-markdown__editor",
  "dgx-mu": "kanso-dialog__note--muted",
  "dgx-mw": "kanso-markdown--window",
  "dgx-n": "kanso-dialog__count",
  "dgx-narrow": "kanso-settings--narrow",
  "dgx-nm": "kanso-dialog__name",
  "dgx-ondawn": "kanso-update--dawn",
  "dgx-one": "kanso-settings__columns--single",
  "dgx-past": "kanso-update__timeline-dot--past",
  "dgx-pet": "kanso-dojo__classic-pet",
  "dgx-petc": "kanso-dojo__pet-card",
  "dgx-pets": "kanso-dojo__pets",
  "dgx-ph": "kanso-dialog__placeholder",
  "dgx-pick": "kanso-keyboard__selection",
  "dgx-pn": "kanso-arrangement__pane",
  "dgx-pp": "kanso-credit__avatar--person",
  "dgx-pr": "kanso-settings__piece",
  "dgx-prog": "kanso-dojo__progress",
  "dgx-prs": "kanso-settings__pieces",
  "dgx-q": "kanso-update__description",
  "dgx-r": "kanso-dialog__row",
  "dgx-rel": "kanso-update__release",
  "dgx-res": "kanso-dojo__classic-result",
  "dgx-rh": "kanso-update__timeline-heading",
  "dgx-ri": "kanso-update__item",
  "dgx-rn": "kanso-update__timeline-release",
  "dgx-rs": "kanso-update__summary",
  "dgx-rt": "kanso-dialog__meta",
  "dgx-rv": "kanso-update__release-heading",
  "dgx-s": "kanso-dialog__detail",
  "dgx-say": "kanso-dojo__classic-feedback",
  "dgx-sbx": "kanso-sidebar--sleep-preview",
  "dgx-sc": "kanso-dialog__scope",
  "dgx-setwin": "kanso-settings",
  "dgx-shape": "kanso-arrangement",
  "dgx-sm": "kanso-arrangement__meta",
  "dgx-small": "kanso-update__timeline-dot--small",
  "dgx-stale": "kanso-update--stale",
  "dgx-stat": "kanso-dojo__classic-statistics",
  "dgx-stuck": "kanso-sleep--blocked",
  "dgx-sum": "kanso-settings__area-summary",
  "dgx-t": "kanso-dialog__title",
  "dgx-tabhd": "kanso-sleep__tab-heading",
  "dgx-tall": "kanso-settings--tall",
  "dgx-tile": "kanso-dialog__tile",
  "dgx-tl": "kanso-update__timeline",
  "dgx-trail": "kanso-dojo__classic-cell--trail",
  "dgx-two": "kanso-dialog__row--two-lines",
  "dgx-tx": "kanso-dialog__text",
  "dgx-up": "kanso-update__controls",
  "dgx-v": "kanso-update__version-name",
  "dgx-ver": "kanso-update__status",
  "dgx-w3": "kanso-settings__piece-scope",
  "dgx-w340": "kanso-dialog--small",
  "dgx-wh": "kanso-keyboard__meaning",
  "dgx-wmap": "kanso-settings__window-map",
  "dgx-world": "kanso-dojo__world",
  "dgx-ws": "kanso-settings__map-layout",
  "dgx-x": "kanso-dialog__hint",
  "dgx-you": "kanso-update__installed",
  "dgx-zz": "kanso-sleep",
  "dlg": "kanso-dialog--settings",
  "dlg-h": "kanso-dialog__heading",
  "done": "kanso-row--done",
  "dot": "kanso-dot",
  "dw-clouds": "kanso-dawn__clouds",
  "dw-enso": "kanso-dawn__circle",
  "dw-glow": "kanso-dawn__glow",
  "dw-line": "kanso-dawn__horizon",
  "dw-night": "kanso-dawn__night",
  "dw-replay": "kanso-dawn__replay",
  "dw-stars": "kanso-dawn__stars",
  "dw-sun": "kanso-dawn__sun",
  "e": "kanso-content__entry",
  "ed": "kanso-editor--editing",
  "empty": "kanso-state-empty--inline",
  "err": "kanso-state-line--error",
  "f": "kanso-content__summary",
  "find": "kanso-field--search",
  "first": "kanso-tree__branch--first",
  "flex": "kanso-layout__grow",
  "foc": "kanso-control--focus",
  "fold": "kanso-section--collapsible",
  "footcard": "kanso-sidebar--footer-preview",
  "fr": "kanso-sidebar__footer-row",
  "free": "kanso-story--free",
  "ft": "kanso-share__footer",
  "full": "kanso-search__excerpt--full",
  "g": "kanso-content__gap",
  "gap": "kanso-toolbar__gap",
  "ghost": "kanso-pane--ghost",
  "glad": "kanso-feedback--success",
  "go": "kanso-cell--goal",
  "grip": "kanso-header__grip",
  "grp": "kanso-sidebar__group",
  "grp-h": "kanso-prototype__group-heading",
  "grp-sh": "kanso-prototype__group-subheading",
  "gt": "kanso-project__counts",
  "h": "kanso-content__heading",
  "h1": "kanso-markdown__heading",
  "h2": "kanso-markdown__subheading",
  "hd": "kanso-share__header",
  "hint": "kanso-key--hint",
  "hk": "kanso-diff__line--hunk",
  "hl": "kanso-prototype--highlight",
  "hmark": "kanso-brand__mark",
  "hov": "kanso-control--hover",
  "hrow": "kanso-prototype__row",
  "hv": "kanso-row--hover",
  "i": "kanso-icon",
  "i12": "kanso-icon--inline",
  "i13": "kanso-icon--narrow",
  "i14": "kanso-icon--row",
  "i15": "kanso-icon--control",
  "i17": "kanso-icon--chrome",
  "ib": "kanso-button--icon",
  "icx-c": "kanso-icon__example",
  "icx-grid": "kanso-icon__examples",
  "icx-m": "kanso-icon__description",
  "icx-n": "kanso-icon__name",
  "idle": "kanso-agent--idle",
  "ink": "kanso-header--foreground",
  "it": "kanso-status-bar__item",
  "j": "kanso-brand__subtitle",
  "k": "kanso-story__theme",
  "k-dark": "kanso-story--dark",
  "k-light": "kanso-story--light",
  "kbx-bar": "kanso-tokens__space",
  "kbx-box": "kanso-tokens__radius",
  "kbx-e": "kanso-tokens__example",
  "kbx-h": "kanso-tokens__height",
  "kbx-n": "kanso-tokens__name",
  "kbx-p": "kanso-tokens__panel",
  "kbx-s": "kanso-tokens__sample",
  "kbx-t": "kanso-tokens__row",
  "kc": "kanso-key--outlined",
  "kit-act": "kanso-action",
  "kit-armed": "kanso-action--armed",
  "kit-caret": "kanso-field__caret",
  "kit-dim": "kanso-control--dim",
  "kit-field": "kanso-field",
  "kit-glint": "kanso-text--glint",
  "kit-ib": "kanso-button--inline-icon",
  "kit-kbd": "kanso-key",
  "kit-row": "kanso-row--interactive",
  "kit-seg": "kanso-segmented",
  "kit-shim": "kanso-skeleton--sweep",
  "kit-skl": "kanso-skeleton__list",
  "kit-switch": "kanso-switch",
  "kst-acts": "kanso-state-block__actions",
  "kst-block": "kanso-state-block",
  "kst-btn": "kanso-button--tonal",
  "kst-empty": "kanso-state-empty",
  "kst-line": "kanso-state-line",
  "kst-onrow": "kanso-state-block--on-row",
  "kst-panel": "kanso-state-block__panel",
  "kst-pdot": "kanso-state-line__pending-dot",
  "kst-pend": "kanso-state-line--pending",
  "kst-toast": "kanso-toast",
  "kst-what": "kanso-state-block__what",
  "kst-why": "kanso-state-block__why",
  "kz": "kanso-prototype__kit",
  "l": "kanso-content__line",
  "l1": "kanso-row--depth-one",
  "l2": "kanso-row--depth-two",
  "lb": "kanso-row__label",
  "lbl": "kanso-prototype__label",
  "ld": "kanso-row__leading-icon",
  "lede": "kanso-prototype__introduction",
  "li": "kanso-picture__line",
  "lights": "kanso-window__controls",
  "lit": "kanso-key--lit",
  "live": "kanso-row--live",
  "ln": "kanso-simulator__line",
  "lnav": "kanso-prototype__sidebar",
  "lnav-hd": "kanso-prototype__sidebar-heading",
  "lnav-t": "kanso-prototype__sidebar-title",
  "lnav-tg": "kanso-prototype__sidebar-toggle",
  "lo": "kanso-chart__bar--low",
  "log": "kanso-log",
  "lst": "kanso-prototype__list",
  "lv": "kanso-level__label",
  "m": "kanso-mark",
  "m-blk": "kanso-mark--blocked",
  "m-done": "kanso-mark--done",
  "m-idle": "kanso-mark--idle",
  "m-work": "kanso-mark--working",
  "mach": "kanso-row--machine",
  "menu": "kanso-menu",
  "meta": "kanso-prototype__meta",
  "metric": "kanso-metric",
  "mh": "kanso-menu__heading",
  "mi": "kanso-menu-item",
  "mid": "kanso-tree__branch--middle",
  "mini": "kanso-window--preview",
  "mini-map": "kanso-minimap",
  "miss": "kanso-feedback--missed",
  "mk": "kanso-brand--inline",
  "mk-big": "kanso-brand--large",
  "more": "kanso-activity__more",
  "mr": "kanso-menu__separator",
  "n": "kanso-row__name",
  "nav": "kanso-prototype__navigation",
  "needs": "kanso-header__attention",
  "new": "kanso-prototype--new",
  "nm": "kanso-header__name",
  "no": "kanso-annotation--inactive",
  "node": "kanso-level__node",
  "notes": "kanso-prototype__notes",
  "o": "kanso-control__outline",
  "off": "kanso-control--off",
  "on": "kanso-control--on",
  "one": "kanso-row--single-line",
  "open": "kanso-prototype--open",
  "p-facts": "kanso-panel__facts",
  "p-h": "kanso-panel__header",
  "p-hero": "kanso-panel__hero",
  "p-num": "kanso-panel__number",
  "p-scope": "kanso-panel__scope",
  "p-t": "kanso-panel__title",
  "p-verdict": "kanso-panel__verdict",
  "page": "kanso-prototype__page",
  "pane": "kanso-pane",
  "panel": "kanso-panel",
  "panes": "kanso-window__panes",
  "path": "kanso-worktree__path",
  "pax-abs": "kanso-panel__overlay",
  "pax-at": "kanso-panel__tooltip",
  "pax-back": "kanso-panel__back",
  "pax-bar": "kanso-code__conflict",
  "pax-bars": "kanso-chart__bars",
  "pax-bas": "kanso-panel__examples",
  "pax-blk": "kanso-markdown__block",
  "pax-busy": "kanso-menu-item--busy",
  "pax-caret": "kanso-code__caret",
  "pax-ck": "kanso-menu-item__check",
  "pax-code": "kanso-code",
  "pax-ctl": "kanso-panel__controls",
  "pax-cut": "kanso-panel__truncation",
  "pax-cw": "kanso-panel__content",
  "pax-delta": "kanso-panel__delta",
  "pax-diff": "kanso-diff",
  "pax-dir": "kanso-row__directory-path",
  "pax-dl": "kanso-diff__line",
  "pax-dlg": "kanso-dialog--worktree",
  "pax-end": "kanso-panel__actions--end",
  "pax-ev": "kanso-review__event",
  "pax-heat": "kanso-heatmap",
  "pax-hl": "kanso-panel__header-action",
  "pax-hov": "kanso-row--panel-hover",
  "pax-hovc": "kanso-card--hover",
  "pax-hq": "kanso-panel__header-note",
  "pax-in1": "kanso-panel__indent",
  "pax-inl": "kanso-review__comment",
  "pax-lb": "kanso-metadata__label",
  "pax-li": "kanso-review__line",
  "pax-line": "kanso-panel__note",
  "pax-line1": "kanso-panel__hint",
  "pax-load": "kanso-picture__loading",
  "pax-loss": "kanso-worktree__loss",
  "pax-md": "kanso-markdown",
  "pax-mi-note": "kanso-menu-item__note",
  "pax-mk": "kanso-file__status",
  "pax-more": "kanso-panel__more",
  "pax-mr": "kanso-metadata__row",
  "pax-nar": "kanso-panel--narrow",
  "pax-new": "kanso-panel__new",
  "pax-nm": "kanso-row__filename",
  "pax-off": "kanso-button--off",
  "pax-on": "kanso-button--active",
  "pax-per": "kanso-panel__period",
  "pax-pic": "kanso-picture",
  "pax-plus": "kanso-review__add",
  "pax-qt": "kanso-panel__tabs",
  "pax-rb": "kanso-chart__range",
  "pax-rel": "kanso-panel__anchor",
  "pax-rep": "kanso-review__reply",
  "pax-rw": "kanso-panel__gap",
  "pax-said": "kanso-panel__last-action",
  "pax-scrim": "kanso-panel__scrim",
  "pax-share": "kanso-share",
  "pax-skl": "kanso-panel__skeleton",
  "pax-snip": "kanso-review__snippet",
  "pax-sp": "kanso-file__spacer",
  "pax-src": "kanso-markdown__source",
  "pax-st": "kanso-panel__status",
  "pax-stats": "kanso-panel__statistics",
  "pax-sub": "kanso-menu-item__description",
  "pax-tbl": "kanso-markdown__table",
  "pax-ticks": "kanso-chart__ticks",
  "pax-top": "kanso-row--open",
  "pax-ttl": "kanso-panel__subtitle",
  "pax-under": "kanso-field__hint",
  "pax-v": "kanso-row__value",
  "pax-wait": "kanso-button--pending",
  "pax-who": "kanso-metadata__person",
  "pax-x": "kanso-worktree__details",
  "pay": "kanso-simulator__payment",
  "pb": "kanso-tab--panel",
  "pbx-2f": "kanso-panel__pair",
  "pbx-3f": "kanso-panel__triple",
  "pbx-acts": "kanso-panel__actions",
  "pbx-age": "kanso-panel__age",
  "pbx-anchor": "kanso-panel__menu-anchor",
  "pbx-app": "kanso-simulator__app",
  "pbx-ax-blk": "kanso-contrast--blocked",
  "pbx-ax-caret": "kanso-contrast__caret",
  "pbx-ax-col": "kanso-contrast__column",
  "pbx-ax-foc": "kanso-contrast--focus",
  "pbx-ax-grid": "kanso-contrast__grid",
  "pbx-ax-mini": "kanso-contrast__window",
  "pbx-ax-pair": "kanso-contrast__pair",
  "pbx-ax-pane": "kanso-contrast__pane",
  "pbx-ax-sbar": "kanso-contrast__status-bar",
  "pbx-ax-sec": "kanso-contrast__section",
  "pbx-ax-side": "kanso-contrast__sidebar",
  "pbx-ax-sum": "kanso-contrast__summary",
  "pbx-ax-tabwrap": "kanso-contrast__table",
  "pbx-ax-thumb": "kanso-contrast__segmented",
  "pbx-ax-v": "kanso-contrast__value",
  "pbx-axis": "kanso-chart__axis",
  "pbx-bulk": "kanso-panel__bulk-actions",
  "pbx-caret": "kanso-panel__caret",
  "pbx-chart": "kanso-chart",
  "pbx-cmd": "kanso-row__command",
  "pbx-col": "kanso-panel__column",
  "pbx-ctl": "kanso-panel__metric-controls",
  "pbx-dev": "kanso-simulator",
  "pbx-div": "kanso-panel__divider",
  "pbx-dj": "kanso-dojo",
  "pbx-dj-b": "kanso-dojo__body",
  "pbx-dj-board": "kanso-dojo__board",
  "pbx-dj-c": "kanso-dojo__cell",
  "pbx-dj-ch": "kanso-dojo__character",
  "pbx-dj-edge": "kanso-dojo__progress-strip",
  "pbx-dj-grid": "kanso-dojo__grid",
  "pbx-dj-h": "kanso-dojo__header",
  "pbx-dj-hachi": "kanso-dojo__mascot",
  "pbx-dj-k": "kanso-dojo__key",
  "pbx-dj-kb": "kanso-dojo__keyboard",
  "pbx-dj-kr": "kanso-dojo__key-row",
  "pbx-dj-ln": "kanso-dojo__line",
  "pbx-dj-lv": "kanso-dojo__level",
  "pbx-dj-main": "kanso-dojo__main",
  "pbx-dj-menu": "kanso-dojo__menu",
  "pbx-dj-new": "kanso-dojo__record",
  "pbx-dj-path": "kanso-dojo__path",
  "pbx-dj-pkeys": "kanso-dojo__path-keys",
  "pbx-dj-res": "kanso-dojo__result",
  "pbx-dj-rk": "kanso-dojo__result-keys",
  "pbx-dj-rl": "kanso-dojo__result-label",
  "pbx-dj-rtop": "kanso-dojo__result-heading",
  "pbx-dj-say": "kanso-dojo__feedback",
  "pbx-dj-st": "kanso-dojo__statistics",
  "pbx-dj-talk": "kanso-dojo__conversation",
  "pbx-dj-text": "kanso-dojo__text",
  "pbx-dj-zz": "kanso-dojo__sleep-label",
  "pbx-dot-off": "kanso-dot--off",
  "pbx-dsec": "kanso-panel__device-heading",
  "pbx-file": "kanso-panel__file",
  "pbx-focus": "kanso-panel--focus",
  "pbx-frame": "kanso-simulator__frame",
  "pbx-frozen": "kanso-simulator--frozen",
  "pbx-gap": "kanso-panel__spacer",
  "pbx-gone": "kanso-panel__button--removed",
  "pbx-hero": "kanso-panel__metric-hero",
  "pbx-hov": "kanso-panel__row--hover",
  "pbx-hv": "kanso-panel__hover-row",
  "pbx-hv3": "kanso-panel__trailing",
  "pbx-ind": "kanso-panel__row--indented",
  "pbx-ind2": "kanso-panel__row--deep",
  "pbx-kv": "kanso-panel__key-value",
  "pbx-light": "kanso-panel__preview",
  "pbx-lt": "kanso-panel__legend",
  "pbx-metric": "kanso-panel__metric",
  "pbx-mn": "kanso-panel__legend-item",
  "pbx-no": "kanso-text--fail",
  "pbx-note": "kanso-panel__annotation",
  "pbx-num": "kanso-panel__metric-number",
  "pbx-ok": "kanso-text--pass",
  "pbx-ov": "kanso-simulator__overlay",
  "pbx-pic": "kanso-picture--annotated",
  "pbx-pin": "kanso-annotation",
  "pbx-plan": "kanso-panel__plan",
  "pbx-plist": "kanso-panel__annotations",
  "pbx-pnote": "kanso-annotation__note",
  "pbx-port": "kanso-row__port",
  "pbx-q": "kanso-panel__qualifier",
  "pbx-r": "kanso-panel__row-meta",
  "pbx-r1": "kanso-panel__compact-row",
  "pbx-ra": "kanso-panel__row-actions",
  "pbx-reg": "kanso-annotation__region",
  "pbx-scr": "kanso-simulator__screen",
  "pbx-sent": "kanso-panel__sent",
  "pbx-shot": "kanso-picture__content",
  "pbx-st": "kanso-panel__state",
  "pbx-stack": "kanso-panel__stack",
  "pbx-strip": "kanso-picture__thumbnails",
  "pbx-strip-sb": "kanso-panel__sidebar-preview",
  "pbx-sub": "kanso-panel__statistics-section",
  "pbx-sum": "kanso-panel__summary",
  "pbx-swr": "kanso-panel__switch-row",
  "pbx-t": "kanso-panel__table",
  "pbx-tables": "kanso-panel__tables",
  "pbx-tag": "kanso-panel__tag",
  "pbx-tb": "kanso-panel__toolbar",
  "pbx-th": "kanso-thumbnail",
  "pbx-tools": "kanso-panel__tools",
  "pbx-v": "kanso-panel__row-value",
  "pc": "kanso-settings__piece-choice",
  "ph": "kanso-header",
  "pi": "kanso-icon--program",
  "pill": "kanso-badge",
  "pj": "kanso-agent__project",
  "pk": "kanso-chart__bar--peak",
  "pm": "kanso-header__process",
  "pn": "kanso-project__name",
  "proj": "kanso-project",
  "press": "kanso-control--pressed",
  "prow": "kanso-row",
  "prow2": "kanso-row--two-lines",
  "ptr": "kanso-story__pointer",
  "q": "kanso-content__note",
  "ql": "kanso-button--quiet",
  "qt": "kanso-segmented--tabs",
  "r": "kanso-row__meta",
  "rb": "kanso-button--disclosure",
  "reset": "kanso-settings__reset",
  "ring": "kanso-control--ring",
  "rise": "kanso-dawn--rising",
  "row": "kanso-story__layout-row",
  "s": "kanso-row__detail",
  "s12": "kanso-mark--small",
  "s15": "kanso-mark--large",
  "s17": "kanso-brand--small",
  "s3": "kanso-segmented--options",
  "sb": "kanso-sidebar",
  "sb-foot": "kanso-sidebar__footer",
  "sb-list": "kanso-sidebar__list",
  "sb-tools": "kanso-sidebar__tools",
  "sb-top": "kanso-sidebar__header",
  "sbar": "kanso-status-bar",
  "sbx-a0": "kanso-sidebar__agent",
  "sbx-away": "kanso-sidebar__activity",
  "sbx-br": "kanso-sidebar__branch",
  "sbx-breath": "kanso-sidebar__mark--breathing",
  "sbx-c0": "kanso-sidebar--inactive-machine",
  "sbx-caret": "kanso-sidebar__caret",
  "sbx-cmp": "kanso-sidebar__machine",
  "sbx-cnt": "kanso-sidebar__count",
  "sbx-da": "kanso-sidebar__dialog-actions",
  "sbx-dim": "kanso-sidebar--dim",
  "sbx-dlg": "kanso-sidebar__dialog",
  "sbx-dock": "kanso-sidebar__dock",
  "sbx-dt": "kanso-sidebar__dialog-title",
  "sbx-dt-bot": "kanso-sidebar__row--drop-after",
  "sbx-dt-top": "kanso-sidebar__row--drop-before",
  "sbx-fam": "kanso-sidebar__family",
  "sbx-fl": "kanso-sidebar__field-label",
  "sbx-flush": "kanso-sidebar--flush",
  "sbx-fold": "kanso-sidebar__fold",
  "sbx-foot": "kanso-sidebar__navigation",
  "sbx-fr": "kanso-sidebar__navigation-row",
  "sbx-g": "kanso-sidebar__branch-line",
  "sbx-gone": "kanso-sidebar__row--removed",
  "sbx-grid": "kanso-sidebar__examples",
  "sbx-h1": "kanso-text--host-red",
  "sbx-h2": "kanso-text--host-green",
  "sbx-h3": "kanso-text--host-yellow",
  "sbx-h4": "kanso-text--host-blue",
  "sbx-h5": "kanso-text--host-violet",
  "sbx-h6": "kanso-text--host-teal",
  "sbx-host": "kanso-sidebar__host",
  "sbx-hov": "kanso-sidebar--hover",
  "sbx-hovrow": "kanso-sidebar__row--hover",
  "sbx-ib": "kanso-sidebar__button",
  "sbx-line": "kanso-sidebar__state-line",
  "sbx-logo": "kanso-sidebar__logo",
  "sbx-m": "kanso-sidebar__emphasis",
  "sbx-mono": "kanso-sidebar__code",
  "sbx-p0": "kanso-sidebar__project",
  "sbx-ph": "kanso-sidebar__placeholder",
  "sbx-pi14": "kanso-icon--sidebar-program",
  "sbx-press": "kanso-sidebar--pressed",
  "sbx-rail": "kanso-rail",
  "sbx-rbrand": "kanso-rail__brand",
  "sbx-rfoot": "kanso-rail__footer",
  "sbx-ring": "kanso-sidebar--focus",
  "sbx-rlist": "kanso-rail__list",
  "sbx-rrow": "kanso-rail__row",
  "sbx-rsep": "kanso-rail__separator",
  "sbx-rtop": "kanso-rail__top",
  "sbx-rule": "kanso-sidebar__separator",
  "sbx-rv": "kanso-rail__views",
  "sbx-sel": "kanso-sidebar__selection",
  "sbx-slab": "kanso-sidebar__slab",
  "sbx-slice": "kanso-sidebar--slice",
  "sbx-solo": "kanso-sidebar--standalone",
  "sbx-sub": "kanso-sidebar--child",
  "sbx-task": "kanso-sidebar__task",
  "sbx-tb": "kanso-sidebar__title-bar",
  "sbx-tbl": "kanso-sidebar__table",
  "sbx-tile": "kanso-rail__tile",
  "sbx-tipat": "kanso-sidebar__tooltip",
  "sbx-tools": "kanso-sidebar__toolbar",
  "sbx-top": "kanso-sidebar__top",
  "sbx-vs": "kanso-sidebar__view-switch",
  "sbx-woke": "kanso-sidebar__wake-status",
  "sbx-wt": "kanso-sidebar__worktree",
  "sbx-wti": "kanso-sidebar__worktree-icon",
  "scroll": "kanso-story__scroll",
  "sec": "kanso-sidebar__section",
  "sect": "kanso-section",
  "seg": "kanso-header__segment",
  "sel": "kanso-row--selected",
  "shim": "kanso-text--shimmer",
  "side": "kanso-story--sidebar",
  "sim-dot": "kanso-simulator__note-point",
  "sim-hint": "kanso-simulator__note-hint",
  "sim-layer": "kanso-simulator__note-layer",
  "sim-note": "kanso-simulator__note-editor",
  "sim-notes": "kanso-simulator__notes",
  "sk": "kanso-skeleton",
  "skw": "kanso-skeleton--breathing",
  "sleep": "kanso-row--sleeping",
  "slept": "kanso-row--asleep",
  "sm": "kanso-button--small",
  "sp": "kanso-layout__spacer",
  "spin": "kanso-button--spinning",
  "sq": "kanso-button--square",
  "st": "kanso-story__entry",
  "st-bar": "kanso-story__bar",
  "st-board": "kanso-story--board",
  "st-col": "kanso-story__column",
  "st-do": "kanso-story__guideline",
  "st-ell": "kanso-story__ellipsis",
  "st-ex": "kanso-story",
  "st-h": "kanso-story__header",
  "st-ic": "kanso-story__icon",
  "st-nav": "kanso-story__navigation",
  "st-no": "kanso-story--avoid",
  "st-ok": "kanso-story--recommended",
  "st-page": "kanso-story__page",
  "st-phil": "kanso-story--philosophy",
  "st-row": "kanso-story__row",
  "st-s": "kanso-story__frame",
  "st-solo": "kanso-story--standalone",
  "st-sw": "kanso-story__swatch",
  "st-type": "kanso-story__type",
  "st-wait": "kanso-story--waiting",
  "st-wrap": "kanso-story--wrap",
  "stage": "kanso-story__stage",
  "stale": "kanso-digest--stale",
  "stalebody": "kanso-panel--stale",
  "story": "kanso-story__article",
  "story-canvas": "kanso-story--canvas",
  "story-frame": "kanso-story__viewport",
  "strong": "kanso-text--strong",
  "stub": "kanso-window__stub",
  "sub": "kanso-row--child",
  "sw": "kanso-thumbnail--swatch",
  "syn-kw": "kanso-code__token--keyword",
  "syn-pn": "kanso-code__token--punctuation",
  "syn-ty": "kanso-code__token--type",
  "t": "kanso-content__text",
  "t-d": "kanso-terminal__text--dim",
  "t-g": "kanso-terminal__text--done",
  "t-m": "kanso-terminal__text--muted",
  "t-o": "kanso-terminal__text--orange",
  "t-r": "kanso-terminal__text--blocked",
  "t-y": "kanso-terminal__text--working",
  "tab": "kanso-tab",
  "tabbar": "kanso-tab-bar",
  "take": "kanso-edge--target",
  "tall": "kanso-field--multiline",
  "tbar": "kanso-prototype__toolbar",
  "tbox": "kanso-terminal__box",
  "term": "kanso-terminal",
  "tip": "kanso-tooltip",
  "tip-live": "kanso-tooltip__trigger",
  "tk": "kanso-row__command-count",
  "tl": "kanso-row__task",
  "tm": "kanso-content__time",
  "tokens": "kanso-tokens",
  "tools": "kanso-header__tools",
  "top": "kanso-prototype__header",
  "topcard": "kanso-sidebar--header-preview",
  "tot": "kanso-picture__total",
  "tr": "kanso-text--truncate",
  "tt": "kanso-prototype__title",
  "two": "kanso-row--double-line",
  "tx": "kanso-prototype__text",
  "u": "kanso-metric__unit",
  "upd": "kanso-update",
  "v": "kanso-content__value",
  "ver": "kanso-update__version",
  "vs": "kanso-segmented--sidebar",
  "w": "kanso-brand__wordmark",
  "w0": "kanso-window--legacy",
  "w0-away": "kanso-activity--legacy",
  "w1": "kanso-window--rest",
  "w1-away": "kanso-activity--rest",
  "w1-bb": "kanso-tab-bar__button",
  "w1-foot": "kanso-sidebar__bottom",
  "w1-gl": "kanso-sidebar__row-name--working",
  "w1-grp": "kanso-sidebar__row-group",
  "w1-list": "kanso-sidebar__rows",
  "w1-mini": "kanso-minimap--rest",
  "w1-n2": "kanso-sidebar__row-text",
  "w1-ph": "kanso-header--rest",
  "w1-r": "kanso-sidebar__row",
  "w1-sbar": "kanso-status-bar--rest",
  "w1-sq": "kanso-sidebar__icon-button",
  "w1-tab": "kanso-tab--rest",
  "w1-tabbar": "kanso-tab-bar--rest",
  "w1-title": "kanso-sidebar__title",
  "w1-tools": "kanso-sidebar__actions",
  "wd": "kanso-row__directory",
  "who": "kanso-host__name",
  "why": "kanso-worktree__reason",
  "wide": "kanso-story--wide",
  "win": "kanso-window",
  "wn": "kanso-worktree__name",
  "work": "kanso-window__workspace",
  "x": "kanso-content__body",
  "z": "kanso-heatmap__cell--empty"
};

const SELECTOR_CLASS = /\/\*[\s\S]*?\*\/|"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\.([a-zA-Z_][\w-]*)/g;
const RULE = /(^|[{}])([^{}]+)(?=\{)/g;

export const STORYBOOK_CLASSES = new Set([
  "sb-show-main", "sbdocs", "sbdocs-wrapper", "sbdocs-content", "docs-story", "docblock-source",
]);
export { CLASSES };

const renamed = (name) => {
  if (STORYBOOK_CLASSES.has(name)) return name;
  if (!Object.hasOwn(CLASSES, name)) throw new Error(`unmapped prototype class: ${name}`);
  return CLASSES[name];
};

export const renameMarkup = (html) => html.replace(/\b(class|className)=(['"])(.*?)\2/gs,
  (_, attribute, quote, value) => `${attribute}=${quote}${value.replace(/\S+/g, renamed)}${quote}`);

export const renameCss = (css) => css.replace(RULE, (_, edge, selector) =>
  edge + selector.replace(/[ \t]+(?=\r?\n)/g, "").replace(SELECTOR_CLASS, (match, name) => name ? `.${renamed(name)}` : match));

export function cssSelectors(css) {
  return [...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(RULE)]
    .map((m) => m[2].trim()).filter((s) => !s.startsWith("@") && !/^(?:from|to|[\d.,%\s]+)$/.test(s));
}

export const selectorClasses = (selector) => [...selector.matchAll(SELECTOR_CLASS)].flatMap((m) => m[1] ? [m[1]] : []);
export const markupClasses = (html) => [...html.matchAll(/\b(?:class|className)=(['"])(.*?)\1/gs)].flatMap((m) => m[2].split(/\s+/).filter(Boolean));

export function importProto(src) {
  if (!src) throw new Error("usage: node scripts/import-proto.mjs <dir>");
  const read = (name) => readFileSync(join(src, name), "utf8");
  const OUT = "stories/proto";

  const LAYOUTS = ["Window at rest", "Sidebar at rest", "Sidebar header, three ways", "hjkl dōjō", "Right-click any piece"];
  const SETTINGS = ["Settings", "Settings, what shows", "Keys", "Window map", "What's new", "Credits"];
  const SUBS = { "States (S21)": "States" };
  const TABLES = ["Every value", "Contrast, light and dark"];
  const LIVE = ["Hover, selected, pressed", "Focus ring", "Field", "Tooltip"];
  const FROZEN = ["sbx-ring", "sbx-press", "sbx-hov", "hov", "press"];

  const BOARDS = {
    Z: "Philosophy",
    K: "Tokens/Every value",
    S21: "Compositions/States",
    I1: "Tokens/Icons",
    A: "Tokens/Colour and wash",
    10: "Layouts/Right-click any piece",
    "01": "Layouts/Window at rest",
    11: "Tokens/Dawn",
    S01: "Layouts/Sidebar at rest",
    S02: "Components/Title and tools",
    S03: "Compositions/Sidebar rows",
    S04: "Compositions/Sidebar rows",
    S05: "Compositions/Sidebar rows",
    S06: "Compositions/Sidebar rows",
    S07: "Compositions/Sidebar rows",
    S08: "Components/While you were away",
    S09: "Compositions/Sidebar rows",
    S10: "Compositions/Sidebar rows",
    S11: "Compositions/Sidebar rows",
    S13: "Compositions/Sidebar rows",
    S14: "Components/New project",
    S15: "Compositions/Sidebar rows",
    S16: "Compositions/Sidebar rows",
    S17: "Compositions/Sidebar rows",
    S18: "Components/Menu",
    S19: "Compositions/Sidebar rows",
    S20: "Layouts/Sidebar at rest",
    S12: "Components/Collapsed rail",
    B1: "Components/Tab bar",
    B2: "Components/Tab bar",
    B3: "Components/Panel menu",
    B4: "Components/Pane header",
    B5: "Components/Pane header",
    B11: "Components/Header digest",
    B7: "Components/Find in the conversation",
    B10: "Layouts/Right-click any piece",
    B8: "Components/Status bar",
    B6: "Components/Edges and minimap",
    B9: "Compositions/Bars",
    "08": "Compositions/Panel pieces",
    P17: "Compositions/Panel pieces",
    S0: "Compositions/Panel pieces",
    Q7: "Components/Menu",
    Q10: "Components/Annotated picture",
    Q8: "Compositions/Panel pieces",
    Q9: "Compositions/Panel pieces",
    P01: "Compositions/Files and PR",
    P02: "Compositions/Files and PR",
    P03: "Components/Code",
    P04: "Components/Markdown",
    P05: "Compositions/Files and PR",
    "06": "Compositions/Files and PR",
    "07": "Compositions/Files and PR",
    P06: "Compositions/Files and PR",
    P07: "Compositions/Files and PR",
    P08: "Compositions/Files and PR",
    P09: "Compositions/Files and PR",
    P10: "Compositions/Files and PR",
    P16: "Compositions/Files and PR",
    P15: "Compositions/Files and PR",
    P11: "Components/Shipped",
    P12: "Components/Shipped",
    P13: "Components/Worktree row, open",
    P14: "Components/New worktree",
    Q1: "Compositions/Panel pieces",
    S1: "Compositions/Panel pieces",
    Q2: "Compositions/Panel pieces",
    S2: "Compositions/Panel pieces",
    Q3: "Compositions/Panel pieces",
    S3: "Compositions/Panel pieces",
    Q4: "Compositions/Panel pieces",
    S4: "Compositions/Panel pieces",
    Q5: "Compositions/Panel pieces",
    S5: "Compositions/Panel pieces",
    Q6: "Components/Simulator screen",
    S6: "Components/Simulator screen",
    D12: "Components/Settings tabs",
    D13: "Components/Settings tabs",
    D2: "Components/Settings tabs",
    D3: "Components/Settings tabs",
    D4: "Components/Settings tabs",
    D5: "Components/Settings tabs",
    D14: "Components/Settings tabs",
    D1: "Components/Dialog",
    D6: "Compositions/Menu and dialog",
    D7: "Compositions/Menu and dialog",
    D8: "Components/Pick list",
    D9: "Components/Pick list",
    D10: "Components/Markdown window",
    D15: "Components/Dialog",
    D11a: "Layouts/hjkl dōjō",
    D11b: "Layouts/hjkl dōjō",
    D11c: "Layouts/hjkl dōjō",
  };

  function stripRefs(text) {
    return text
      .replace(/\b(?:[AKLZ]|I1|S01|S21): /g, "")
      .replace(/\bFrom boards? [A-Z0-9]+\.\s*/gi, "")
      .replace(/\s*\((?:[Bb]oards?\b[^)]*|[A-Z]\d{0,2}[a-z]?|[ab]|0[1-9]|10|11|K, S21|11, S02|S21, state\.css)\)/g, "")
      .replace(/\b[Bb]oards? (?:[A-Z]\d{0,2}[a-z]?|\d{2})(?:['’]s)?\b/g, "")
      .replace(/\b(?:on|across) (?:these|the|every) boards?(?: themselves)?\b/gi, "")
      .replace(/\(([A-Z]\d{1,2})[:,] /g, "(")
      .replace(/\b[A-Z]\d{1,2}[a-z]?\b/g, (code) => BOARDS[code]?.split("/").at(-1).toLowerCase() ?? ({ P00: "the state pattern", D11: "the dōjō" })[code] ?? code)
      .replace(/\bboards?\b/gi, (word) => word.toLowerCase().endsWith("s") ? "examples" : "example")
      .replace(/\b[\w-]+\.html\b/g, "")
      .replace(/\b(?:from|as in) [AKLZ]\b/g, "")
      .replace(/[ \t]+([.,;:])/g, "$1").replace(/[ \t]{2,}/g, " ").trim();
  }

  function place({ group, sub, title }) {
    if (group === "Tokens") return "Tokens/Every value";
    if (group === "Atoms") return `${sub === "Controls" ? "Compositions" : "Tokens"}/${sub}`;
    if (group === "Molecules") return `Compositions/${SUBS[sub] ?? sub}`;
    if (group === "Compositions") return LAYOUTS.includes(title) ? `Layouts/${title}` : `Components/${SETTINGS.includes(title) ? "Settings tabs" : title}`;
    return null;
  }

  const plain = (text) => text.normalize("NFD").replace(/[̀-ͯ]/g, "");
  const slug = (text) => plain(text).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const exportName = (text) => plain(text).replace(/'/g, "").split(/[^A-Za-z0-9]+/).filter(Boolean).map((w) => w[0].toUpperCase() + w.slice(1)).join("");

  function closeOf(html, start) {
    const tag = /<(\/?)div\b[^>]*>/g;
    tag.lastIndex = start;
    let depth = 0;
    for (let m; (m = tag.exec(html)); ) {
      depth += m[1] ? -1 : 1;
      if (depth === 0) return tag.lastIndex;
    }
    throw new Error(`unbalanced div at ${start}`);
  }

  function children(html) {
    const out = [];
    for (let i = html.indexOf("<div"); i !== -1; ) {
      const end = closeOf(html, i);
      out.push(html.slice(i, end));
      i = html.indexOf("<div", end);
    }
    return out;
  }

  const LIGHT = /<div class="[^"]*\bk-light\b[^"]*"/;

  function dropLight(html) {
    for (let m; (m = LIGHT.exec(html)); ) {
      let start = m.index;
      let end = closeOf(html, start);
      const cap = /<p class="cap"[^>]*>[^<]*light<\/p>\s*$/i.exec(html.slice(0, start));
      if (cap) start = cap.index;
      html = html.slice(0, start) + html.slice(end);
    }
    return html.replace(/<div>\s*<\/div>/g, "");
  }

  function example(html) {
    const start = html.indexOf('<div class="st-ex">');
    const inner = html.slice(start, closeOf(html, start)).replace(/^<div class="st-ex">/, "").replace(/<\/div>$/, "");
    const kids = children(inner);
    const paired = kids.length > 1 && kids.some((k) => LIGHT.test(k.slice(0, k.indexOf(">") + 1)));
    const kept = paired ? kids.filter((k) => !LIGHT.test(k.slice(0, k.indexOf(">") + 1))).join("") : inner;
    const one = dropLight(kept).replace(/class="([^"]*)"/g, (_, c) => `class="${c.split(/\s+/).filter((n) => n !== "k-dark" && n !== "k-light").join(" ")}"`);
    if (/k-(dark|light)/.test(one)) throw new Error("a theme class is left");
    return `<div class="st-ex">${one}</div>`;
  }

  function notes() {
    const byFolder = {};
    for (const board of read("board-notes.md").split(/^## /m).slice(1)) {
      const [head, ...body] = board.trim().split("\n");
      const folder = BOARDS[head.split(" ")[0]];
      if (!folder) throw new Error(`board ${head} has no folder`);
      (byFolder[folder] ??= []).push({ name: stripRefs(head.replace(/^\S+\s+/, "").replace(/\s*\(`#[^`]*`\)$/, "")), body: stripRefs(body.join("\n")) });
    }
    return byFolder;
  }

  const tokens = new Set(readFileSync("site/tokens.css", "utf8").match(/--[\w-]+(?=:)/g));
  const CHROME = /^(:root\{color-scheme|@import|body\{|a\{color|\.page[{.]|\.top[{ ]|\.nav[{ ]|\.board\{|\.bh[{ ]|\.bg\{|@media \(max-width:1100px\)|\.notes|\.cap\{|\.ctl-|\.st\{|\.st-wait|\.hrow|:root\{--nav-w|\.lnav|\.grp-|section\.board|@media \(prefers-reduced-motion:reduce\)\{\.lnav|@media \(max-width:960px\)|\.kz\{|\.st-page|\.st-nav|\.story|\.st-h )/;
  const exportedCss = read("sb-atomic.css");
  const exportedStories = JSON.parse(read("sb-atomic-stories.json"));
  renameCss(exportedCss);
  exportedStories.forEach((entry) => renameMarkup(entry.html));
  const css = exportedCss
    .split("\n")
    .filter((line) => !CHROME.test(line))
    .join("\n")
    .replace(/(?<=^|\})(\.k\.k-|\.k-)(dark|light)\{([^}]*)\}/gm, (_, __, t, body) => {
      const kept = body.split(";").filter((d) => d.trim() && !tokens.has(d.split(":")[0].trim()));
      return kept.length ? `:root[data-theme="${t}"] .k{${kept.join(";")}}` : "";
    })
    .replaceAll(".k.k-dark,.k.k-light{", ".k{")
    .replaceAll(".k-light ", ':root[data-theme="light"] ')
    .replace(/\.brx-edge\{[^}]*\}/, (rule) => rule.replace("gap:var(--k-sp-2)", "gap:var(--k-sp-1)"))
    .replace(/\.brx-slot\{[^}]*\}/, (rule) => rule.replace("gap:var(--k-sp-2)", "gap:var(--k-sp-hair)").replace("font-size:11.5px", "font-size:var(--k-fs-meta)"))
    .replace(/\n{3,}/g, "\n\n");
  if (/k-(dark|light)/.test(css)) throw new Error("a theme selector is left");
  const interactive = /([^{}]+)\{\s*cursor:pointer;transition:/.exec(css)[1].split(",").map((s) => /^\s*\.([\w-]+)\s*$/.exec(s)?.[1]).filter(Boolean);

  const focusable = (html) => html.replace(/<(\w+) class="([^"]*)"(?![^>]*tabindex)/g, (m, tag, c) => (c.split(/\s+/).some((n) => interactive.includes(n)) ? `${m} tabindex="0"` : m));

  function live(html) {
    const [, open, drawn] = /^(<div class="st-ex"><div class="k st-s free">)(.*)<\/div><\/div>$/s.exec(html);
    const thawed = drawn.replace(/class="([^"]*)"/g, (_, c) => `class="${c.split(/\s+/).filter((n) => !FROZEN.includes(n)).join(" ")}"`).replace(/;?background:var\(--hover\)/g, "");
    const trigger = drawn.startsWith('<span class="tip"') ? `<span class="tip-live"><span class="ib"><svg class="i"><use href="#lu-refresh-cw"/></svg></span>${drawn}</span>` : thawed;
    return `${open}<p class="cap">Live</p>${trigger}<p class="cap">Drawn</p>${drawn}</div></div>`;
  }

  const text = (html) => html.replace(/<svg.*?<\/svg>/gs, "").replace(/<[^>]*>/g, "").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  const q = (s) => JSON.stringify(s);
  const mdxText = (text) => stripRefs(text).split(/(`[^`]*`)/).map((part, i) => (i % 2 ? part : part.replace(/[{}<>]/g, (c) => `\\${c}`))).join("");
  const cell = (tag, value, span) => `<${tag}${span ? ` colSpan={${span}}` : ""}>{${q(stripRefs(value))}}</${tag}>`;
  const jsxTable = (head, rows) => `<table>\n<thead><tr>${head.map((h) => cell("th", h)).join("")}</tr></thead>\n<tbody>\n${rows.map((r) => `<tr>${r}</tr>`).join("\n")}\n</tbody>\n</table>`;

  function tableOf(html) {
    if (html.includes("<table")) {
      const [, cap, table] = /<p class="cap">([^<]*)<\/p>(?:<div[^>]*>)?\s*(<table.*?<\/table>)/s.exec(html);
      const [head, ...rows] = [...table.matchAll(/<tr>(.*?)<\/tr>/gs)].map((m) =>
        [...m[1].matchAll(/<(td|th)([^>]*)>(.*?)<\/\1>/gs)].map(([, , attrs, inner]) => ({ value: text(inner), span: /colspan="(\d+)"/.exec(attrs)?.[1] })));
      return `${mdxText(text(cap))}\n\n${jsxTable(head.map((c) => c.value), rows.map((r) => r.map((c) => cell("td", c.value, c.span)).join("")))}`;
    }
    const out = [];
    let rows = [];
    const flush = () => {
      if (!rows.length) return;
      const values = rows.some((r) => r.value);
      out.push(jsxTable(values ? ["Token", "Value", "Use"] : ["Token", "Use"], rows.map((r) => (values ? [r.name, r.value, r.use] : [r.name, r.use]).map((v) => cell("td", v)).join(""))));
      rows = [];
    };
    for (const m of html.matchAll(/<span class="p-t">(.*?)<\/span>|<div class="p-scope">(.*?)<\/div>|<div class="sect">(.*?)<\/div>|<div class="kbx-t">(.*?)<\/div>/gs)) {
      if (m[4]) {
        const part = (c) => text(new RegExp(`<span class="${c}"[^>]*>(.*?)</span>`, "s").exec(m[4])[1]);
        const value = part("kbx-s");
        rows.push({ name: part("kbx-n"), value: value === "Aa" ? "" : value, use: part("r") });
        continue;
      }
      flush();
      if (m[1]) out.push(`### ${mdxText(text(m[1]))}`);
      if (m[2]) out.push(`{${q(text(m[2]))}}`);
      if (m[3]) out.push(`#### ${mdxText(text(m[3]))}`);
    }
    flush();
    return out.join("\n\n");
  }

  const folders = new Map();
  const tables = {};
  for (const entry of exportedStories) {
    const folder = place(entry);
    if (!folder) continue;
    const [, title, caption] = /<div class="st-h"><b>(.*?)<\/b><span>(.*?)<\/span>/s.exec(entry.html);
    if (title !== entry.title) throw new Error(`title mismatch: ${entry.title}`);
    if (!folders.has(folder)) folders.set(folder, {});
    if (TABLES.includes(title)) {
      (tables[folder] ??= []).push({ title, body: `${mdxText(text(caption))}\n\n${tableOf(entry.html)}` });
      continue;
    }
    const stories = folders.get(folder);
    // The export still combines these two independent Bars pieces.
    const pieces = title === "Edges and minimap" ? [
      {
        title: "Edge",
        caption: "Off-screen pane tiles on either side of an empty pane in the strip.",
        html: '<div class="st-ex"><div class="k"><div class="brx-stripv" style="width:400px;height:120px"><div class="brx-edge">‹<span class="brx-tile kit-ib"><svg class="pi"><use href="#p-codex"/></svg></span></div><div class="pane" style="flex:1"></div><div class="brx-edge">›<span class="brx-tile kit-ib"><svg class="pi"><use href="#p-codex"/></svg></span><span class="brx-tile kit-ib"><svg class="pi"><use href="#p-claude"/></svg></span><span class="brx-tile kit-ib"><svg class="pi"><use href="#lu-terminal"/></svg></span></div></div></div></div>',
      },
      {
        title: "Minimap slot",
        caption: "The minimap and zoom control in their own status bar slot.",
        html: '<div class="st-ex"><div class="k"><div class="brx-slot"><span class="mini-map"><i class="f" style="width:24px"></i><i style="width:24px"></i></span><span style="width:8px"></span><span class="c-dim">−</span><span class="c-mu" style="margin:0 var(--k-sp-1)">2</span><span class="c-dim">+</span></div></div></div>',
      },
    ] : [{ title, caption, html: example(entry.html) }];
    for (const piece of pieces) {
      let name = exportName(piece.title);
      while (stories[name]) name += "2";
      stories[name] = { title: stripRefs(piece.title), caption: stripRefs(piece.caption).replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&"), html: focusable(LIVE.includes(piece.title) ? live(piece.html) : piece.html) };
    }
  }

  const why = notes();
  for (const folder of Object.keys(why)) {
    if (folder !== "Philosophy" && !folders.has(folder)) throw new Error(`no folder ${folder}`);
  }

  const cssRules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, sel, body]) => ({
    classes: (sel.match(/\.[\w-]+/g) ?? []).map((c) => c.slice(1)),
    vars: [...body.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]),
  }));
  const isToken = (v) => tokens.has(v) || /^--w\d+$/.test(v);

  function prompt(folder, stories, boards) {
    const html = Object.values(stories).map((s) => s.html).join("");
    const used = new Set([...html.matchAll(/class="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/)));
    const vars = new Set([...html.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]));
    for (const r of cssRules) if (r.classes.length && r.classes.every((c) => used.has(c))) r.vars.forEach((v) => vars.add(v));
    const kit = [...used].filter((c) => /^(kit|kst)-/.test(c)).sort();
    const sentences = boards.flatMap((b) => b.body.split("\n").filter((l) => l.startsWith("- ")).flatMap((l) => l.replace(/^- (\*\*[^*]+\*\* )?/, "").split(/(?<=\.)\s+(?=[A-Z"])/)));
    const defects = sentences.filter((s) => /\bdefect\b|^(Never|No)\b/.test(s) && !/^No \w+ is\b/.test(s));
    const [level, sub] = folder.split("/");
    return [
      `Build ${sub} (${level}) for kansō with the kit only: the tokens in kanso/tokens.json and the drawings in stories/proto.css.`,
      ...(vars.size ? [`Use these tokens: ${[...vars].filter(isToken).sort().join(", ")}.`] : []),
      ...(html ? [`Draw these pieces: ${Object.values(stories).map((s) => s.title).join("; ")}.`] : []),
      ...(kit.length ? [`Reuse these kit classes: ${kit.map(renamed).join(", ")}.`] : []),
      ...(html ? ["Follow these rules:", ...Object.values(stories).map((s) => `- ${s.title}: ${s.caption}`)] : []),
      ...(boards.length ? [`Apply every guideline of ${boards.map((b) => b.name).join("; ")}.`] : []),
      ...(defects.length ? ["Treat as a defect:", ...defects.map((s) => `- ${s}`)] : []),
    ].join("\n");
  }


  rmSync(OUT, { recursive: true, force: true });
  mkdirSync(OUT, { recursive: true });
  writeFileSync(join(OUT, "story.js"), "export const story = ({ html, caption }) => ({ render: () => html, parameters: { docs: { description: { story: caption } } } });\n");
  for (const [folder, stories] of folders) {
    const file = slug(folder);
    const boards = why[folder] ?? [];
    const drawn = Object.keys(stories).length > 0;
    if (drawn) writeFileSync(join(OUT, `${file}.json`), `${JSON.stringify(stories, (k, v) => (k === "title" ? undefined : k === "html" ? renameMarkup(v) : v), 1)}\n`);
    if (drawn) writeFileSync(join(OUT, `${file}.stories.js`), `import stories from './${file}.json';
import { story } from './story.js';

export default { title: ${q(folder)} };

${Object.entries(stories).map(([k, s]) => `export const ${k} = { name: ${q(s.title)}, ...story(stories.${k}) };`).join("\n")}
`);
    const h1 = folder.split("/")[1];
    const pieces = [...Object.entries(stories).map(([k, s]) => ({ title: s.title, body: `${mdxText(s.caption)}\n\n<Canvas of={stories.${k}} />` })), ...(tables[folder] ?? [])];
    const piece = (p) => (pieces.length > 1 && p.title !== h1 ? `## ${mdxText(p.title)}\n\n${p.body}` : p.body);
    writeFileSync(join(OUT, `${file}.mdx`), `import { Canvas, Meta } from '@storybook/addon-docs/blocks';
${drawn ? `import * as stories from './${file}.stories.js';\n` : ""}
<Meta title=${q(folder)} />

# ${mdxText(h1)}

${pieces.map(piece).join("\n\n")}
${boards.map((b) => `\n${b.name === h1 ? "" : `## ${mdxText(b.name)}\n\n`}${mdxText(b.body)}\n`).join("")}
## Prompt for agents

\`\`\`text
${prompt(folder, stories, boards)}
\`\`\`
`);
  }
  writeFileSync("stories/proto.css", `/* The prototype's own CSS, minus its page chrome; palettes follow site/tokens.css. Written by scripts/import-proto.mjs. */\n${renameCss(css)}`);
  writeFileSync("stories/proto-sprite.svg", read("sb-atomic-sprite.svg"));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) importProto(process.argv[2]);
