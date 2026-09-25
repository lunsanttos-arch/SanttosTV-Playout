"use strict";

const fs = require("node:fs");
const path = require("node:path");
const crypto = require("node:crypto");

// The Windows Electron safeStorage implementation encrypts with DPAPI.
// The database never contains the plaintext SRT passphrase.
function createSecretStore(userDataPath, encryption) {
    const folder = path.join(userDataPath, "secrets");
    const file = path.join(folder, "srt-passphrase.bin");

    function isAvailable() {
        return Boolean(
            encryption &&
            encryption.isEncryptionAvailable?.() &&
            typeof encryption.encryptString === "function" &&
            typeof encryption.decryptString === "function"
        );
    }

    function read() {
        if (!fs.existsSync(file)) return "";
        if (!isAvailable()) throw new Error("Armazenamento protegido do Windows indisponível.");
        const bytes = fs.readFileSync(file);
        return encryption.decryptString(bytes);
    }

    function write(passphrase) {
        if (typeof passphrase !== "string" || passphrase.length < 10 || passphrase.length > 79) {
            throw new Error("A senha SRT deve ter entre 10 e 79 caracteres.");
        }
        if (!isAvailable()) {
            throw new Error("O Windows não disponibilizou a proteção necessária para armazenar a senha SRT.");
        }
        const encrypted = encryption.encryptString(passphrase);
        if (!Buffer.isBuffer(encrypted) || !encrypted.length) {
            throw new Error("O Windows não conseguiu criptografar a senha SRT.");
        }
        fs.mkdirSync(folder, { recursive: true, mode: 0o700 });
        const temporary = file + "." + process.pid + "." + crypto.randomUUID() + ".tmp";
        try {
            fs.writeFileSync(temporary, encrypted, {mode:0o600});
            fs.renameSync(temporary, file);
        } finally {
            if (fs.existsSync(temporary)) fs.rmSync(temporary,{force:true});
        }
    }

    function clear() {
        if (fs.existsSync(file)) fs.rmSync(file);
    }

    return {file,read,write,clear,isAvailable};
}

module.exports = {createSecretStore};
