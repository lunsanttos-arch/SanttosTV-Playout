"use strict";
const assert = require('node:assert/strict');
const { PassThrough } = require('node:stream');
const { VideoClockedPcm } = require('../src/core/audio/video-clocked-pcm');
const { NdiAudioSource } = require('../src/core/audio/ndi-audio-source');

(async () => {
    for (const fps of [[30, 1], [30000, 1001]]) {
        const profile = { sampleRate: 48000, channels: 2, fpsN: fps[0], fpsD: fps[1] };
        const source = new PassThrough();
        const clock = new VideoClockedPcm(source, profile);
        const packets = [];
        const audio = new NdiAudioSource({ pcmStream: clock.output, sampleRate: 48000, channels: 2,
            onPcmData: chunk => packets.push(chunk) }).start();
        const data = Buffer.alloc(48000 * 8, 0x12);
        source.write(data.subarray(0, 3));
        source.write(data.subarray(3, 12001));
        source.write(data.subarray(12001));
        assert.equal(audio.snapshot().bytesSent, 0, 'Audio must wait for a complete PROGRAM frame');
        assert.equal(audio.child, null, 'Shared PCM must not spawn a second decoder');
        for (let frame = 1; frame <= 15; frame++) {
            clock.advance();
            await new Promise(resolve => setImmediate(resolve));
            const expected = Math.floor(frame * profile.sampleRate * profile.fpsD / profile.fpsN) * 8;
            assert.equal(audio.snapshot().bytesSent, expected);
            assert(packets.every(chunk => chunk.length % 8 === 0), 'IPC packets must contain complete stereo samples');
        }
        assert(Buffer.concat(packets).equals(data.subarray(0, audio.snapshot().bytesSent)), 'Chunk boundaries must preserve PCM');
        audio.stop(); clock.stop();
        assert.equal(source.listenerCount('data'), 0, 'Stopped feeds must release decoder listeners');
    }
    const tail = new PassThrough();
    const tailClock = new VideoClockedPcm(tail, { sampleRate: 48000, channels: 2, fpsN: 30, fpsD: 1 });
    tail.write(Buffer.alloc(48000 * 8 * 2));
    assert(tail.isPaused(), 'Ahead-of-video audio must apply bounded backpressure');
    tailClock.stop();
    const ended = new Promise(resolve => tail.once('end', resolve));
    tail.end(Buffer.alloc(128 * 1024));
    await Promise.race([ended, new Promise((_, reject) => setTimeout(() => reject(Error('Paused PCM tail prevents decoder close')), 500))]);
    assert.equal(tailClock.buffered, 0);
    console.log('VIDEO CLOCKED PCM QA: passed startup gate, fractional frame rates, arbitrary chunks and cleanup');
})().catch(error => { console.error(error); process.exitCode = 1; });
