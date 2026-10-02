"use strict";

function normalizeStreamIndex(value) {
    return Number.isSafeInteger(value) && value >= 0
        ? value
        : null;
}

function videoFilterInput(streamIndex) {
    const normalized =
        normalizeStreamIndex(
            streamIndex
        );

    return normalized === null
        ? "[0:v:0]"
        : `[0:${normalized}]`;
}

module.exports = {
    normalizeStreamIndex,
    videoFilterInput
};
