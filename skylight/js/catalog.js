// What the home screen knows about the apps on this TV: friendly names, icons, colours, notes and
// the default order. Apps it doesn't know are only shown if they were installed from the store or
// sideloaded; Samsung's own background and system apps are left out.
window.SKYLIGHT_CATALOG = {
  // The big row, in order. Apps can be moved in or out of it on the TV (hold OK).
  favourites: [
    'xvvl3S1TT1.TizenTubeStandalone',
    'org.tizen.netflix-app',
    'org.tizen.primevideo',
    'fiZNCxMH9Y.Hotstar',
    'KCKrPXpbAS.JioCinema',
    'EUKHUxrGQA.SonyLIV',
    'com.samsung.tv.aria-video'
  ],
  // The start of the bottom row; other apps follow alphabetically.
  first: [
    'rJeHak5zRg.Spotify',
    '9Ur5IzDKqV.TizenYouTube',
    'org.tizen.browser',
    'com.samsung.tv.gallery',
    'com.samsung.tv.SmartThingsApp',
    'org.tizen.tv-viewer',
    'org.tizen.menu'
  ],
  // Never shown: this app itself, Samsung's promo, AI and system apps, and the apps you asked to
  // have removed. The TV only lets those be deleted from its own Apps settings, so they stay
  // hidden here even before (or if) that happens.
  hidden: [
    'skylightTV.Skylight',
    'yL49PNFmjW.PromotionApp',
    'com.samsung.tv.bixby-promotion',
    'com.samsung.tv.AICompanionUILauncher',
    '25emanual3.emanual',
    'com.samsung.tv.aria-video',
    'com.samsung.tv.SecurityCenter',
    'skylightTV.SkylightWatch',
    'xvvl3S1TT1.StandaloneService',
    'HEPsqFNie0.tvplusstandalone',
    'WSRedi0001.WorkspaceRedi',
    '2025ePop02.SmartTV'
  ],

  // `icon` is bundled with this app (the TV doesn't let apps read other apps' icons).
  // `tile` is the tile colour, `ink` the text on it, `glow` the light it casts when selected.
  // `always` shows a system app even though the TV marks it as not for app lists.
  // `dial` is the app's name in the TV's casting service, and `engine` the resident Samsung app it
  // really runs inside (YouTube's player). Both help the helper notice when such an app closes,
  // since the TV keeps the engine loaded all the time.
  apps: {
    'org.tizen.tv-viewer': { name: 'TV', note: 'Live TV and whatever is plugged into HDMI', icon: 'icons/tv.svg',
      tile: '#28309C', ink: '#FFFFFF', glow: '#5A6CF0', always: true },
    'org.tizen.menu': { name: 'Settings', note: 'The TVâ€™s own settings', icon: 'icons/settings.svg',
      tile: '#3A4152', ink: '#FFFFFF', glow: '#8A94A8', always: true },
    'xvvl3S1TT1.TizenTubeStandalone': { name: 'YouTube', note: 'Ad-free, with sponsor segments skipped',
      icon: 'icons/tizentube.png', dial: 'TizenTube', engine: 'com.samsung.tv.cobalt-yt',
      tile: '#C4161C', ink: '#FFFFFF', glow: '#FF2D2D' },
    'org.tizen.netflix-app': { name: 'Netflix', dial: 'Netflix', icon: 'icons/netflix.png', tile: '#1A0B0C', ink: '#FFFFFF', glow: '#E50914' },
    'org.tizen.primevideo': { name: 'Prime Video', dial: 'AmazonInstantVideo', icon: 'icons/primevideo.png', tile: '#0D5F8C', ink: '#FFFFFF', glow: '#1AA7EC' },
    'fiZNCxMH9Y.Hotstar': { name: 'JioHotstar', icon: 'icons/jiohotstar.png', tile: '#3A2A9E', ink: '#FFFFFF', glow: '#6A5BFF' },
    'KCKrPXpbAS.JioCinema': { name: 'JioCinema', icon: 'icons/jiocinema.svg', tile: '#8E0D60', ink: '#FFFFFF', glow: '#E0359B' },
    'EUKHUxrGQA.SonyLIV': { name: 'SonyLIV', dial: 'SonyLIV', icon: 'icons/sonyliv.png', tile: '#2B1B4A', ink: '#FFFFFF', glow: '#E0457B' },
    'com.samsung.tv.aria-video': { name: 'Apple TV', tile: '#18181C', ink: '#F2F2F4', glow: '#A1A1AA' },
    'rJeHak5zRg.Spotify': { name: 'Spotify', icon: 'icons/spotify.png', tile: '#11612F', ink: '#FFFFFF', glow: '#1DB954' },
    '9Ur5IzDKqV.TizenYouTube': { name: 'YouTube (official)', note: 'Samsungâ€™s YouTube app, with ads',
      icon: 'icons/youtube.png', dial: 'YouTube', engine: 'com.samsung.tv.cobalt-yt',
      tile: '#3A0D10', ink: '#FFFFFF', glow: '#E5191F' },
    'org.tizen.browser': { name: 'Browser', icon: 'icons/browser.svg', tile: '#1D3F9E', ink: '#FFFFFF', glow: '#4C8DFF' },
    'com.samsung.tv.gallery': { name: 'Gallery', icon: 'icons/gallery.svg', tile: '#9C4A16', ink: '#FFFFFF', glow: '#F2A93B' },
    'com.samsung.tv.SmartThingsApp': { name: 'SmartThings', icon: 'icons/smartthings.png', tile: '#0F5F78', ink: '#FFFFFF', glow: '#3DC1D3' }
  }
};
