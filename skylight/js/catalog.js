// What the home screen knows about the apps on this TV: friendly names, icons, colours, notes and
// the default order. Apps it doesn't know are only shown if they were installed from the store or
// sideloaded; Samsung's own background and system apps are left out.
window.SKYLIGHT_CATALOG = {
  // The big row, in order. Apps can be moved in or out of it on the TV (hold OK).
  favourites: [
    'org.tizen.netflix-app',
    '9Ur5IzDKqV.TizenYouTube',
    'org.tizen.primevideo',
    'MCmYXNxgcu.DisneyPlus',
    'com.samsung.tv.aria-video',
    'SKvHIMBcln.CraveTV',
    'rJyOSqC6Up.PPlusIntl',
    'rJeHak5zRg.Spotify'
  ],
  // The start of the bottom row; other apps follow alphabetically.
  first: [
    'org.tizen.tv-viewer',
    'org.tizen.menu',
    'org.tizen.browser',
    'com.samsung.tv.gallery',
    'mMABuBMnjq.TSNGO',
    'com.samsung.tv.SmartThingsApp'
  ],
  // Never shown: this app itself, Samsung's promo, AI and system apps.
  hidden: [
    'skylightTV.Skylight',
    'skylightTV.SkylightWatch',
    'yL49PNFmjW.PromotionApp',
    'com.samsung.tv.bixby-promotion',
    'com.samsung.tv.AICompanionUILauncher',
    '22emanual5.emanual',
    '25emanual3.emanual',
    'com.samsung.tv.SecurityCenter',
    'J9fZJDMi1v.SecurityCenter',
    'HEPsqFNie0.tvplusstandalone',
    'WSRedi0001.WorkspaceRedi',
    '2022ePop02.SmartTV',
    '2025ePop02.SmartTV',
    'kleboAnim1.Main'
  ],

  // `icon` is bundled with this app (the TV doesn't let apps read other apps' icons).
  // `tile` is the tile colour, `ink` the text on it, `glow` the light it casts when selected.
  apps: {
    'org.tizen.tv-viewer': { name: 'HDMI / TV', note: 'HDMI input and sources', icon: 'icons/tv.svg',
      tile: '#28309C', ink: '#FFFFFF', glow: '#5A6CF0', always: true },
    'org.tizen.menu': { name: 'Settings', note: 'Projector settings', icon: 'icons/settings.svg',
      tile: '#3A4152', ink: '#FFFFFF', glow: '#8A94A8', always: true },
    'org.tizen.netflix-app': { name: 'Netflix', dial: 'Netflix', icon: 'icons/netflix.png', tile: '#1A0B0C', ink: '#FFFFFF', glow: '#E50914' },
    '9Ur5IzDKqV.TizenYouTube': { name: 'YouTube', icon: 'icons/youtube.png', dial: 'YouTube', engine: 'com.samsung.tv.cobalt-yt',
      tile: '#3A0D10', ink: '#FFFFFF', glow: '#E5191F' },
    'org.tizen.primevideo': { name: 'Prime Video', dial: 'AmazonInstantVideo', icon: 'icons/primevideo.png', tile: '#0D5F8C', ink: '#FFFFFF', glow: '#1AA7EC' },
    'MCmYXNxgcu.DisneyPlus': { name: 'Disney+', dial: 'DisneyPlus', icon: 'icons/disneyplus.png', tile: '#0B1536', ink: '#FFFFFF', glow: '#1D52EC' },
    'com.samsung.tv.aria-video': { name: 'Apple TV', icon: 'icons/appletv.svg', tile: '#18181C', ink: '#F2F2F4', glow: '#A1A1AA' },
    'SKvHIMBcln.CraveTV': { name: 'Crave', icon: 'icons/crave.svg', tile: '#00263E', ink: '#FFFFFF', glow: '#00A3E0' },
    'rJyOSqC6Up.PPlusIntl': { name: 'Paramount+', icon: 'icons/paramountplus.svg', tile: '#002E72', ink: '#FFFFFF', glow: '#0066FF' },
    'rJeHak5zRg.Spotify': { name: 'Spotify', icon: 'icons/spotify.png', tile: '#11612F', ink: '#FFFFFF', glow: '#1DB954' },
    'mMABuBMnjq.TSNGO': { name: 'TSN', icon: 'icons/tsn.svg', tile: '#8B0000', ink: '#FFFFFF', glow: '#CC0000' },
    'org.tizen.browser': { name: 'Browser', icon: 'icons/browser.svg', tile: '#1D3F9E', ink: '#FFFFFF', glow: '#4C8DFF' },
    'com.samsung.tv.gallery': { name: 'Gallery', icon: 'icons/gallery.svg', tile: '#9C4A16', ink: '#FFFFFF', glow: '#F2A93B' },
    'com.samsung.tv.SmartThingsApp': { name: 'SmartThings', icon: 'icons/smartthings.png', tile: '#1558B0', ink: '#FFFFFF', glow: '#3B82F6' }
  }
};
