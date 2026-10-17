"use strict";
const fs=require('node:fs'),path=require('node:path');
function resolveMediaRuntime(name){const env=process.env[name==='ffmpeg'?'FFMPEG_BIN':'FFPROBE_BIN'];if(env){if(!path.isAbsolute(env)||!fs.existsSync(env))throw Error(`Runtime ${name} inválido.`);return env;}
 const executable=name+(process.platform==='win32'?'.exe':'');
 const candidates=[process.resourcesPath&&path.join(process.resourcesPath,'runtime',executable),path.join(__dirname,'../runtime',executable)].filter(Boolean);
 const bundled=candidates.find(fs.existsSync);if(bundled)return bundled;
 if(__dirname.includes('app.asar'))throw Error(`Runtime ${name} de instalação ausente. Reinstale um pacote completo.`);
 if(process.platform==='linux'&&fs.existsSync('/usr/bin/'+name))return '/usr/bin/'+name;
 const mod=require(name==='ffmpeg'?'ffmpeg-static':'@derhuerst/ffprobe-static');const file=(typeof mod==='string'?mod:mod.path||mod.default).replace('app.asar','app.asar.unpacked');if(!fs.existsSync(file))throw Error(`Runtime ${name} não encontrado.`);return file;}
function supportedMediaVersion(text) {
 const match = /version (?:n)?(\d+)\.(\d+)(?:\.(\d+))?/.exec(text);
 if (!match) return false;
 const [major, minor, patch] = match.slice(1).map(value => Number(value || 0));
 return major > 7 || (major === 7 && (minor > 1 || (minor === 1 && patch >= 5)));
}
const verified = new Set();
function verifyProgramRuntime(file) {
 if (verified.has(file)) return;
 const { execFileSync } = require('node:child_process');
 const inspect = option => execFileSync(file, ['-hide_banner', option], { encoding: 'utf8', windowsHide: true, timeout: 10000 });
 const filters = inspect('-filters');
 const encoders = inspect('-encoders');
 const protocols = inspect('-protocols').split(/\r?\n/).map(line => line.trim());
 const missing = [];
 for (const name of ['drawtext', 'overlay', 'scale', 'pad', 'split', 'fps', 'format', 'setsar', 'colorchannelmixer', 'aresample', 'aformat', 'loudnorm', 'volume', 'acompressor', 'alimiter']) {
  if (!new RegExp('^\\s*[.A-Z|]+\\s+' + name + '\\s', 'm').test(filters)) missing.push('filtro ' + name);
 }
 for (const name of ['libx264', 'aac', 'mjpeg', 'rawvideo', 'pcm_f32le']) {
  if (!new RegExp('^\\s*[.A-Z|]+\\s+' + name + '\\s', 'm').test(encoders)) missing.push('encoder ' + name);
 }
 for (const name of ['http', 'https', 'srt', 'rtmp', 'rtmps']) if (!protocols.includes(name)) missing.push('protocolo ' + name);
 if (missing.length) throw Error('Runtime FFmpeg incompleto: ' + missing.join(', ') + '. Configure FFMPEG_BIN com um build completo ou prepare src/core/runtime para a instalação.');
 verified.add(file);
}
module.exports={resolveMediaRuntime,supportedMediaVersion,verifyProgramRuntime};
