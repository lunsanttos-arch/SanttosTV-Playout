"use strict";

class JpegFrameParser {
    constructor(onFrame) {
        if (typeof onFrame !== "function") {
            throw new Error("Callback de frame JPEG inválido.");
        }

        this.onFrame = onFrame;
        this.buffer = Buffer.alloc(0);
    }

    write(chunk) {
        if (!Buffer.isBuffer(chunk) || chunk.length === 0) {
            return;
        }

        this.buffer =
            this.buffer.length === 0
                ? Buffer.from(chunk)
                : Buffer.concat([
                      this.buffer,
                      chunk
                  ]);

        while (this.buffer.length >= 4) {
            const start =
                this.buffer.indexOf(
                    Buffer.from([
                        0xff,
                        0xd8
                    ])
                );

            if (start < 0) {
                this.buffer =
                    this.buffer.length > 1
                        ? this.buffer.subarray(
                              this.buffer.length -
                                  1
                          )
                        : this.buffer;
                return;
            }

            if (start > 0) {
                this.buffer =
                    this.buffer.subarray(
                        start
                    );
            }

            const end =
                this.buffer.indexOf(
                    Buffer.from([
                        0xff,
                        0xd9
                    ]),
                    2
                );

            if (end < 0) {
                return;
            }

            const frame =
                Buffer.from(
                    this.buffer.subarray(
                        0,
                        end + 2
                    )
                );

            this.buffer =
                this.buffer.subarray(
                    end + 2
                );

            this.onFrame(frame);
        }
    }

    reset() {
        this.buffer =
            Buffer.alloc(0);
    }
}

module.exports = {
    JpegFrameParser
};
