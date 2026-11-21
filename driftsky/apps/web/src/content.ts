export const SUPPORT_EMAIL = 'support@driftsky.app';
/** Launching on Mac first. Build with VITE_WINDOWS=1 once the Windows app ships. */
export const WINDOWS = import.meta.env.VITE_WINDOWS === '1';
/** "Mac" or "Mac or PC", "Macs" or "Macs or PCs". */
export const DEVICE = WINDOWS ? 'Mac or PC' : 'Mac';
export const DEVICES = WINDOWS ? 'Macs or PCs' : 'Macs';
export const PRICE_ONE = 9;
export const PRICE_FIVE = 15;

export const FAQ: Array<{ q: string; a: string; link?: { href: string; label: string } }> = [
  {
    q: 'What’s included?',
    a: 'All of it: the six effects, the five wallpapers, and every update we ship from here on. One payment, no subscription.',
  },
  {
    q: 'Which computers does it run on?',
    a: WINDOWS
      ? 'Macs on macOS 14 Sonoma or later, with Apple silicon or Intel, and PCs on Windows 10 (version 2004 or later) or Windows 11.'
      : 'Any Mac on macOS 14 Sonoma or later, with Apple silicon or Intel.',
  },
  {
    q: 'How do I unlock it?',
    a: 'Once you’ve paid, we email you a license key. Open Driftsky, paste the key, and you’re done.',
  },
  {
    q: 'Can I put it on more than one computer?',
    a: `A $${PRICE_ONE} key covers 1 computer and a $${PRICE_FIVE} key covers up to 5. ${WINDOWS ? 'Macs and PCs count the same, so mix them however you like. ' : ''}Switching computers? Remove the key in the app on the old one, then paste it on the new one.`,
  },
  {
    q: 'I can’t find my key.',
    a: 'Search your inbox for “Driftsky license key”. Still nothing? We can send it again.',
    link: { href: '/lost-key', label: 'Email me my key' },
  },
  {
    q: 'Will it slow my Mac down?',
    a: 'No. It draws with the graphics chip, runs at half strength on battery and in Low Power Mode, and pauses whenever a full-screen app is in front or the display is asleep.',
  },
  {
    q: 'Can I still click things under the snow?',
    a: 'Yes, always. Driftsky sits over your screen, but every click goes straight through to whatever is underneath.',
  },
  {
    q: 'How do I change the wallpaper?',
    a: 'Open Driftsky, go to Wallpapers and pick one. It’s applied to every screen at once.',
  },
  {
    q: 'Can I get a refund?',
    a: `If Driftsky doesn’t run on your computer and you tell us within 3 days of buying, yes. Write to ${SUPPORT_EMAIL}.`,
    link: { href: '/refunds', label: 'Read the refund policy' },
  },
];

export const STEPS = [
  { title: 'Pay once', body: `$${PRICE_ONE} for 1 ${DEVICE} or $${PRICE_FIVE} for 5. Your license key arrives by email.` },
  { title: 'Download and paste your key', body: 'Open Driftsky and paste the key from the email. Nothing else to set up.' },
  { title: 'Choose your weather', body: 'Pick an effect and a wallpaper. Driftsky then lives quietly in your menu bar.' },
];
