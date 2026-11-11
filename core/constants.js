// Global constants, in their own module to avoid circular imports. PURE: no SillyTavern imports.
export const extensionName = "st_desloper";
// The extension's own folder, worked out from where this file was loaded: installing from a Git
// URL names the folder after the repo, so a fixed folder name would break those installs.
export const extensionFolderPath = new URL("..", import.meta.url).href.replace(/\/$/, "");
export const LOG_PREFIX = "[ST Desloper]";
