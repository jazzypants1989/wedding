# Thank-you card reveal — sound sample provenance

All source recordings are **CC0 (public domain)** from
[BigSoundBank](https://bigsoundbank.com) (Joseph SARDIN). CC0 requires no
attribution, but provenance is documented here so it stays auditable. Each
linked page states "CC0 (public domain): Free and royalty-free."

Retrieved: **2026-07-20**. No account/login was needed; downloads are direct.

Sources were downloaded as 320 kbps / 48 kHz mono MP3 (the sparkling-water clip
is 64 kbps / 44.1 kHz mono), decoded to 16-bit PCM WAV with `afconvert`, then
trimmed / faded / peak-normalized with a small zero-dep Node WAV script (no
ffmpeg available in this environment), and finally encoded to AAC in an MP4
container with `afconvert -f m4af -d aac -b 49152`. All four browsers of concern
(Safari, Chrome, Firefox) play m4a/AAC via `<audio>`, so no Ogg fallback is
shipped.

| File | Beat | Source title | Source page | License | Final duration | Processing |
|------|------|--------------|-------------|---------|----------------|------------|
| `tap-wood.m4a` | 1 — sealed-envelope tap | "Gavel, 1 blow" (s1588) — a single wooden gavel strike | https://bigsoundbank.com/gavel-1-blow-s1588.html | CC0 | 0.32 s, mono | fade in 2 ms / out 60 ms, peak-normalized to −1 dBFS |
| `open-paper.m4a` | 2 — envelope opening | "Paper" (s0785) — handling a sheet of paper | https://bigsoundbank.com/sound-0785-paper.html | CC0 | 1.70 s, mono | trimmed to 0.30–2.00 s (steady rustle), fade in 20 ms / out 140 ms, peak −1.7 dBFS |
| `cascade-chimes.m4a` | 3 — words cascading (primary) | Chimes "Dream" #8 (s2086) — cluster wind-chime twinkle | https://bigsoundbank.com/chimes-dream-8-s2086.html | CC0 | 2.14 s, mono | trailing-silence trim, fade in 4 ms / out 350 ms, peak −1.7 dBFS |
| `cascade-bells.m4a` | 3 — words cascading (alt) | Chimes "Butterfly" #4 (s2090) — longer bell-tree twinkle | https://bigsoundbank.com/chimes-butterfly-4-s2090.html | CC0 | 2.65 s, mono | trimmed to first 2.8 s, fade in 4 ms / out 600 ms, peak −1.7 dBFS |
| `celebrate-cork.m4a` | 4 — celebration (primary) | "Champagne cork #2" (s0648) — a cork that pops | https://bigsoundbank.com/champagne-cork-2-s0648.html | CC0 | 0.84 s, stereo | fade in 2 ms / out 150 ms, peak −0.7 dBFS |
| `celebrate-fizz.m4a` | 4 — celebration (alt) | "Sparkling water" (s0230) — effervescent fizz/bubbles | https://bigsoundbank.com/sparkling-water-s0230.html | CC0 | 2.20 s, mono | trimmed to 7.55–9.75 s (steady fizz), fade in 60 ms / out 400 ms, peak −1.9 dBFS |

## Notes

- BigSoundBank's site-wide license is CC0 for current items; a few older items
  are CC-BY. **Each page above was individually checked and states CC0.**
- The `UPLOAD/wav/<id>.wav` direct links are hotlink-protected (return HTML), so
  the `UPLOAD/mp3/<id>.mp3` direct links were used as the source instead — same
  recording, high bitrate.
