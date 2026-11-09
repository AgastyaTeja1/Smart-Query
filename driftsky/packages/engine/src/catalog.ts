import type { EffectId } from './types';

/** Names and copy shared by the website, the settings window and the tray menu. */
export const EFFECT_INFO: Record<EffectId, { name: string; tagline: string; detail: string; wallpaper: WallpaperId; icon: string }> = {
  snow: {
    name: 'Snow',
    tagline: 'Settles on your windows.',
    detail: 'Builds up along window tops and the Dock. Move a window and it slides away.',
    wallpaper: 'snow',
    icon: '❄︎',
  },
  rain: {
    name: 'Rain',
    tagline: 'Splashes where it hits.',
    detail: 'Drops burst on window tops, and every so often the sky lights up.',
    wallpaper: 'rain',
    icon: '☂︎',
  },
  sakura: {
    name: 'Sakura',
    tagline: 'Petals that linger.',
    detail: 'Blossom floats down and stays on your windows for a while before it fades.',
    wallpaper: 'stars',
    icon: '✿',
  },
  leaves: {
    name: 'Leaves',
    tagline: 'Brush them away.',
    detail: 'Autumn leaves gather in drifts and fly off when your pointer sweeps past.',
    wallpaper: 'autumn',
    icon: '❦',
  },
  fireflies: {
    name: 'Fireflies',
    tagline: 'They find a resting pointer.',
    detail: 'Little glows wander the screen and circle your pointer when it stays still.',
    wallpaper: 'fireflies',
    icon: '✦',
  },
  starfall: {
    name: 'Starfall',
    tagline: 'Shooting stars that shatter.',
    detail: 'Meteors streak across and break into sparks when they hit a window.',
    wallpaper: 'stars',
    icon: '✧',
  },
};

export const WALLPAPERS = [
  { id: 'snow', name: 'Snow' },
  { id: 'rain', name: 'Rain' },
  { id: 'autumn', name: 'Autumn' },
  { id: 'fireflies', name: 'Fireflies' },
  { id: 'stars', name: 'Stars' },
] as const;
export type WallpaperId = (typeof WALLPAPERS)[number]['id'];
