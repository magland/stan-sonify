// Equal-loudness compensation (ISO 226:2003).
//
// For each frequency, the sound pressure level a pure tone needs to sound as loud as a
// 1 kHz tone at a given loudness level (phon). A channel's gain follows its current pitch,
// so a low tone gets more amplitude than a mid tone to be heard as equally loud. The
// contours assume headphones or speakers with a flat response; small speakers that
// reproduce little below ~150 Hz cannot be corrected this way.
import { BASE_HZ, NUM_CHANNELS } from './pitch'

const F = [20, 25, 31.5, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 500, 630, 800, 1000, 1250, 1600, 2000, 2500, 3150, 4000, 5000, 6300, 8000, 10000, 12500]
const AF = [0.532, 0.506, 0.480, 0.455, 0.432, 0.409, 0.387, 0.367, 0.349, 0.330, 0.315, 0.301, 0.288, 0.276, 0.267, 0.259, 0.253, 0.250, 0.246, 0.244, 0.243, 0.243, 0.243, 0.242, 0.242, 0.245, 0.254, 0.271, 0.301]
const LU = [-31.6, -27.2, -23.0, -19.1, -15.9, -13.0, -10.3, -8.1, -6.2, -4.5, -3.1, -2.0, -1.1, -0.4, 0.0, 0.3, 0.5, 0.0, -2.7, -4.1, -1.0, 1.7, 2.5, 1.2, -2.1, -7.1, -11.2, -10.7, -3.1]
const TF = [78.5, 68.7, 59.5, 51.1, 44.0, 37.5, 31.5, 26.5, 22.1, 17.9, 14.4, 11.4, 8.6, 6.2, 4.4, 3.0, 2.2, 2.4, 3.5, 1.7, -1.3, -4.2, -6.0, -5.4, -1.5, 6.0, 12.6, 13.9, 12.3]

function splAtIndex(i: number, phon: number): number {
  const Af = 4.47e-3 * (10 ** (0.025 * phon) - 1.15) + (0.4 * 10 ** ((TF[i] + LU[i]) / 10 - 9)) ** AF[i]
  return (10 / AF[i]) * Math.log10(Af) - LU[i] + 94
}

// SPL (dB) for a tone at frequency f to reach the given phon; interpolated in log frequency.
export function isoSpl(f: number, phon: number): number {
  const x = Math.log(f)
  let i = 0
  while (i < F.length - 2 && Math.log(F[i + 1]) < x) i++
  const a = (x - Math.log(F[i])) / (Math.log(F[i + 1]) - Math.log(F[i]))
  return splAtIndex(i, phon) * (1 - a) + splAtIndex(i + 1, phon) * a
}

// Amplitudes are scaled per phon level so that all channels at their loudest possible
// pitches sum to at most HEADROOM of full scale.
const HEADROOM = 0.9
const FLAT_GAIN = 0.12 // per-channel amplitude when compensation is off
const scaleCache = new Map<number, number>()

function phonScale(phon: number): number {
  let s = scaleCache.get(phon)
  if (s === undefined) {
    let sum = 0
    for (let k = 0; k < NUM_CHANNELS; k++) {
      let mx = 0
      for (let j = 0; j <= 48; j++) mx = Math.max(mx, 10 ** ((isoSpl(BASE_HZ * 2 ** (k + j / 48), phon) - phon) / 20))
      sum += mx
    }
    s = HEADROOM / sum
    scaleCache.set(phon, s)
  }
  return s
}

// Amplitude for a tone at frequency f: equal loudness at `phon`, or flat if phon is null.
export function toneAmplitude(f: number, phon: number | null): number {
  if (phon === null) return FLAT_GAIN
  return phonScale(phon) * 10 ** ((isoSpl(f, phon) - phon) / 20)
}
