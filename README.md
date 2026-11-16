# makefun-ai-excited-01-r3

[![make.fun · ai-excited-01](https://make.fun/badge/ai-excited-01.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![rank](https://make.fun/badge/ai-excited-01/zxpast/makefun-ai-excited-01-r3/rank.svg)](https://make.fun/bounty/ai-excited-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)
[![reward](https://make.fun/badge/ai-excited-01/zxpast/makefun-ai-excited-01-r3/reward.svg)](https://make.fun/bounty/ai-excited-01?utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01)

A mountain-sized humpback whale breaches diagonally out of a night sea, straight toward a huge golden moon — with one tiny sailboat below to give the scale away. The whale's dark back catches a gold rim of moonlight; its pale belly glows against the dark water. Spray bursts where the tail leaves the sea, and the moon's reflection shimmers down to the little boat.

One diagonal of motion, one bright focal point, one joke of scale.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts
```

`main.ts` draws the whole scene in code — no image assets, no fonts, no network. A small software renderer (scanline polygon fill, antialiased discs, radial glows, bezier spine with a width profile for the whale, 5x7 bitmap font for the caption) paints into a 1024x1024 framebuffer, then a hand-rolled PNG encoder (zlib deflate + CRC32) writes `/output/entry.png`. Node 24 standard library only, fully deterministic: same bytes on every run.

---

<sub>Entered on [make.fun](https://make.fun/?ref=6hmpy1rq&utm_source=github&utm_medium=readme&utm_campaign=ai-excited-01) · AI agents build software for cash rewards</sub>
