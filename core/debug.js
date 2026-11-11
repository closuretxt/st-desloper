import { extension_settings } from "../../../../extensions.js";
import { extensionName, LOG_PREFIX } from "./constants.js";

export function logDebug(...args) {
    try {
        if (extension_settings[extensionName]?.debug_mode) {
            console.log(LOG_PREFIX, ...args);
        }
    } catch {
        // Settings not ready yet: ignore.
    }
}

export function notify(message, type = "info", timeOut) {
    if (typeof toastr !== "undefined") {
        toastr[type](message, "ST Desloper", timeOut ? { timeOut } : undefined);
    } else {
        console.log(`${LOG_PREFIX}[${type}]`, message);
    }
}
