"use strict";
const {test}=require("node:test");
const assert=require("node:assert/strict");
const {Readable,Writable}=require("node:stream");
const {forwardCompleteFrames}=require("../src/main/frame-pump");

test("Video pump never mixes partial frames from adjacent source files",async()=>{
    const collected=[];
    const sink=new Writable({
        highWaterMark:1,
        write(chunk,_encoding,callback){
            setTimeout(()=>{
                collected.push(Buffer.from(chunk));
                callback();
            },5);
        }
    });
    const n1=await forwardCompleteFrames(
        Readable.from([Buffer.from("ABC"),Buffer.from("DEFGHIJ")]),
        sink,4,()=>{}
    );
    assert.equal(n1.frames,2);
    assert.equal(n1.trailingBytes,2);
    const n2=await forwardCompleteFrames(
        Readable.from([Buffer.from("1234"),Buffer.from("5678")]),
        sink,4,()=>{}
    );
    assert.equal(n2.frames,2);
    assert.equal(n2.trailingBytes,0);
    assert.deepEqual(collected.map(x=>x.toString()),["ABCD","EFGH","1234","5678"]);
    sink.end();
});

test("Video pump rejects closed NDI stdin and invalid frame sizes",async()=>{
    const sink=new Writable({write(_b,_e,cb){cb();}});
    await assert.rejects(forwardCompleteFrames(Readable.from([]),sink,0),/inválido/);
    sink.destroy();
    await assert.rejects(
        forwardCompleteFrames(Readable.from([Buffer.from("ABCD")]),sink,4),
        /indisponível/
    );
});
