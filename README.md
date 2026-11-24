# Pairly

**Photograph the sock pile, get the pairs.**

Pairing socks is the most tedious part of laundry, and the odd sock always vanishes. Spread your clean socks out (not touching), take one photo from above, and Pairly outlines every sock and numbers the pairs. Odd socks get a red **?**, and you can save them to the **Lonely socks** drawer. On the next laundry day, Pairly checks every new photo against the drawer and stars any sock that matches one waiting there.

**Try it:** https://rsk0110.github.io/pairly/ (no socks handy? tap **Try a sample pile**)

## How it works

All of it runs in the browser on raw pixels, with no AI service and no upload.

1. **Find the floor:** fit a lighting-aware model of the background colour (a plane per Lab channel, least squares on the image border). Anything that differs from that model by more than the floor's own variation counts as "not floor".
2. **Find the socks:** clean the mask (open, then close) and take connected components above a minimum size. Shapes much bigger than a typical sock and not elongated are flagged as "socks touching".
3. **Describe each sock:**
   - a lighting-robust colour histogram (12 hues × 4 lightness levels, plus grey bins)
   - a texture score (stripes and dots score high)
   - its size and elongation
4. **Pair them:** pairs are chosen to minimise the total distance between partners.
   - It's exact for up to 16 socks (dynamic programming over subsets), and greedy with 2-swap improvement above that.
   - A sock is left unpaired rather than forced into a bad pair.
5. **Remember:** odd socks are stored (thumbnail + description) in the browser's local storage. Later photos are matched against them.

You can fix any mistake: tap two socks to pair them, or tap a paired sock to split it.

## Testing

- `npm test` runs these checks:
  - colour conversion and the threshold maths
  - blob finding on 5 randomly generated sock piles: every sock found, every pair correct, the odd sock left alone
  - similar dark colours (navy vs. charcoal) not confused
  - the greedy path for big piles
  - the lonely-sock drawer finding a partner in a later load
- In the browser, a 900 × 680 photo is analysed in about 0.3 s.

## Limits

- Socks need to be spread out and not touching, on a fairly plain surface.
- Pairs that differ only by a small logo, or socks the same colour as the floor, can confuse it, so check results marked "check this one".

## Develop

```bash
python -m http.server 8000   # open http://localhost:8000
npm test
```

## AI disclosure

Built with Claude (Anthropic) as an AI coding assistant. Pairly itself uses classic computer vision, not AI models.

## License

MIT
