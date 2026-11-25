// Starting guesses for where an app or site belongs. Anything you re-sort in the
// app overrides these. Buckets:
//   money  work that directly makes money
//   busy   work that keeps you busy but does not make money
//   life   time you are enjoying
//   lost   time that just disappears
//   ignore not counted at all (lock screen and similar)
// `passive: true` means sitting still is normal there (video, calls), so the
// tracker waits much longer before deciding you walked away.

const r = (bucket, label, list, extra = {}) =>
  list.map((pattern) => ({ pattern, bucket, label, ...extra }));

/** Matched against the page address: "host" or "host/path-prefix". Longest match wins. */
export const SITE_RULES = [
  ...r('money', 'Deals', [
    'zillow.com', 'redfin.com', 'realtor.com', 'trulia.com', 'loopnet.com', 'crexi.com',
    'propstream.com', 'dealmachine.com', 'privy.pro', 'batchleads.io', 'batchdata.com',
    'propwire.com', 'auction.com', 'hubzu.com', 'xome.com', 'rentometer.com', 'rentcast.io',
    'dealcheck.io', 'biggerpockets.com', 'apartments.com', 'homes.com', 'landwatch.com',
    'mashvisor.com', 'airdna.co', 'reisift.io', 'invelo.com', 'foreclosure.com',
  ]),
  ...r('money', 'Deal paperwork', ['pandadoc.com', 'docusign.com', 'docusign.net', 'dotloop.com', 'hellosign.com']),
  ...r('money', 'Spreadsheets', ['docs.google.com/spreadsheets', 'airtable.com']),
  ...r('money', 'Money in', [
    'stripe.com', 'paypal.com', 'kajabi.com', 'gumroad.com', 'stan.store', 'skool.com',
    'whop.com', 'shopify.com', 'baselane.com', 'stessa.com', 'apartments.com/rental-manager',
    'buildium.com', 'appfolio.com', 'turbotenant.com', 'avail.co', 'rentredi.com',
  ]),
  ...r('money', 'Content creation', [
    'studio.youtube.com', 'canva.com', 'descript.com', 'capcut.com', 'riverside.fm',
    'opus.pro', 'business.facebook.com', 'creators.instagram.com', 'higgsfield.ai', 'artlist.io',
    'gamma.app', 'beehiiv.com', 'substack.com', 'convertkit.com', 'kit.com',
  ]),
  ...r('busy', 'Email', ['mail.google.com', 'outlook.live.com', 'outlook.office.com', 'mail.yahoo.com', 'superhuman.com']),
  ...r('busy', 'Chat', ['slack.com', 'teams.microsoft.com', 'web.whatsapp.com', 'messages.google.com', 'web.telegram.org']),
  ...r('busy', 'Meetings', ['zoom.us', 'meet.google.com', 'calendly.com', 'calendar.google.com', 'cal.com'], { passive: true }),
  ...r('busy', 'Admin', [
    'quickbooks.intuit.com', 'qbo.intuit.com', 'drive.google.com', 'dropbox.com', 'zapier.com',
    'upwork.com', 'fiverr.com', 'gusto.com', 'irs.gov', 'turbotax.intuit.com', '1password.com',
    'accounts.google.com', 'appleid.apple.com', 'icloud.com', 'godaddy.com', 'namecheap.com',
  ]),
  ...r('lost', 'Social feeds', [
    'instagram.com', 'tiktok.com', 'facebook.com', 'x.com', 'twitter.com', 'threads.net',
    'threads.com', 'reddit.com', 'snapchat.com', 'pinterest.com', 'linkedin.com',
  ]),
  ...r('lost', 'Video', [
    'youtube.com', 'netflix.com', 'hulu.com', 'twitch.tv', 'disneyplus.com', 'max.com',
    'primevideo.com', 'peacocktv.com', 'tv.apple.com', 'kick.com',
  ], { passive: true }),
  ...r('lost', 'News', [
    'cnn.com', 'foxnews.com', 'nytimes.com', 'espn.com', 'news.google.com', 'news.ycombinator.com',
    'bbc.com', 'wsj.com', 'bloomberg.com', 'cnbc.com', 'theathletic.com', 'barstoolsports.com',
    'drudgereport.com', 'dailymail.co.uk', 'tmz.com', 'yahoo.com',
  ]),
  ...r('lost', 'Shopping', ['amazon.com', 'ebay.com', 'walmart.com', 'target.com', 'bestbuy.com', 'etsy.com', 'temu.com']),
];

/** Matched against the app's bundle id or name (lower case, exact or contained). */
export const APP_RULES = [
  // --- money ---
  ...r('money', 'Deals', [
    'com.zillow.zillowmap', 'com.redfin.redfin', 'com.move.realtor', 'com.trulia.trulia',
    'com.dealmachine', 'dealmachine', 'propstream', 'com.loopnet.loopnet', 'com.biggerpockets',
    'privy', 'batchleads', 'zillow', 'redfin', 'realtor.com', 'dealcheck',
  ]),
  ...r('money', 'Deal paperwork', ['com.docusign', 'docusign', 'pandadoc', 'dotloop']),
  ...r('money', 'Spreadsheets', [
    'com.microsoft.excel', 'com.apple.numbers', 'com.apple.iwork.numbers', 'com.google.sheets', 'microsoft excel', 'numbers', 'excel.exe',
  ]),
  ...r('money', 'Money in', ['com.stripe', 'com.paypal', 'com.kajabi', 'kajabi', 'com.shopify', 'stessa', 'baselane']),
  ...r('money', 'Content creation', [
    'com.apple.finalcut', 'com.apple.imovieapp', 'com.apple.imovie', 'com.adobe.premierepro',
    'com.adobe.photoshop', 'com.adobe.lightroom', 'com.adobe.aftereffects', 'com.blackmagic-design.davinciresolve',
    'com.lemon.lvoverseas', 'com.bytedance.capcut', 'capcut', 'com.descript', 'descript',
    'com.canva', 'canva', 'com.obsproject.obs-studio', 'obs', 'com.apple.garageband', 'com.apple.logic10',
    'com.google.ios.youtubecreator', 'com.google.ytcreator', 'com.apple.clips', 'com.vimeo',
    'riverside', 'screenflow', 'camtasia', 'com.loom', 'loom', 'com.apple.voicememos', 'com.apple.voicememos.ios',
    'premiere', 'davinci resolve', 'final cut pro', 'com.burbn.barcelona.edits', 'com.instagram.edits',
  ]),
  // --- busywork ---
  ...r('busy', 'Email', [
    'com.apple.mail', 'com.apple.mobilemail', 'com.google.gmail', 'com.microsoft.outlook',
    'com.readdle.smartemail', 'com.superhuman', 'superhuman', 'outlook', 'spark', 'airmail', 'mail',
  ]),
  ...r('busy', 'Chat', [
    'com.tinyspeck.slackmacgap', 'com.tinyspeck.chatlyio', 'slack', 'com.microsoft.teams', 'com.microsoft.teams2',
    'com.microsoft.skype.teams', 'teams', 'net.whatsapp.whatsapp', 'whatsapp', 'com.apple.mobilesms',
    'com.apple.ichat', 'messages', 'ph.telegra.telegraph', 'ru.keepcoder.telegram', 'telegram', 'org.whispersystems.signal',
    'signal', 'com.facebook.messenger', 'messenger', 'com.openphone', 'openphone', 'quo',
  ]),
  ...r('busy', 'Meetings', [
    'us.zoom.xos', 'us.zoom.videomeetings', 'zoom', 'zoom.us', 'com.google.meetings', 'com.apple.facetime',
    'facetime', 'com.webex', 'webex', 'com.microsoft.skype', 'skype',
  ], { passive: true }),
  ...r('busy', 'Admin', [
    'com.apple.finder', 'finder', 'explorer.exe', 'com.apple.systempreferences', 'system settings',
    'com.apple.preferences', 'com.apple.ical', 'com.apple.mobilecal', 'calendar', 'com.google.calendar',
    'com.calendly', 'com.apple.reminders', 'reminders', 'com.apple.preview', 'preview', 'com.apple.documentsapp',
    'com.getdropbox.dropbox', 'dropbox', 'com.google.drive', 'com.intuit.quickbooks', 'quickbooks',
    'com.agilebits.onepassword', '1password', 'com.apple.passwords', 'com.apple.activitymonitor',
    'com.apple.appstore', 'app store', 'com.apple.archiveutility', 'com.apple.installer', 'zapier',
    'com.apple.mobilephone', 'com.apple.mobileaddressbook', 'com.apple.addressbook', 'contacts',
    'com.adobe.reader', 'com.adobe.acrobat', 'acrobat', 'com.apple.shortcuts', 'com.apple.authenticator',
    'com.google.authenticator', 'com.upwork', 'com.apple.findmy', 'com.apple.calculator', 'calculator',
  ]),
  // --- lost ---
  ...r('lost', 'Social feeds', [
    'com.burbn.instagram', 'instagram', 'com.zhiliaoapp.musically', 'tiktok', 'com.facebook.facebook',
    'facebook', 'com.atebits.tweetie2', 'com.twitter.twitter-mac', 'twitter', 'com.burbn.barcelona',
    'threads', 'com.reddit.reddit', 'reddit', 'com.toyopagroup.picaboo', 'snapchat', 'pinterest',
    'com.linkedin.linkedin', 'linkedin', 'com.bereal', 'com.hammerandchisel.discord', 'discord',
  ]),
  ...r('lost', 'Video', [
    'com.google.ios.youtube', 'youtube', 'com.netflix.netflix', 'netflix', 'com.hulu.plus', 'hulu',
    'tv.twitch', 'twitch', 'com.disney.disneyplus', 'com.apple.tv', 'com.hbo.hbonow', 'com.wbd.stream',
    'com.amazon.aiv.aivapp', 'prime video', 'com.peacocktv.peacock', 'vlc', 'org.videolan.vlc', 'com.colliderli.iina',
  ], { passive: true }),
  ...r('lost', 'News', [
    'com.apple.news', 'news', 'com.cnn.iphone', 'com.foxnews.foxnews', 'com.nytimes.nytimes',
    'com.espn.scorecenter', 'espn', 'com.apple.stocks', 'stocks', 'com.yahoo.finance', 'com.robinhood.release.robinhood',
  ]),
  ...r('lost', 'Shopping', ['com.amazon.amazon', 'amazon', 'com.ebay.iphone', 'com.walmart.electronics', 'com.target.target', 'temu']),
  ...r('lost', 'Games', [
    'com.apple.chess', 'steam', 'com.valvesoftware.steam', 'com.supercell', 'com.king', 'com.roblox',
    'com.epicgames', 'com.nianticlabs', 'com.chess.ichess', 'com.nytimes.crossword', 'minecraft',
  ]),
  // --- life ---
  ...r('life', 'Music & podcasts', [
    'com.spotify.client', 'spotify', 'com.apple.music', 'music', 'com.apple.podcasts', 'podcasts',
    'com.audible.iphone', 'audible', 'com.pandora', 'com.google.ios.youtubemusic',
  ], { passive: true }),
  ...r('life', 'Reading', ['com.amazon.lassen', 'kindle', 'com.apple.ibooks', 'com.apple.ibooksx', 'books', 'com.blinkslabs.blinkist']),
  ...r('life', 'Photos & memories', ['com.apple.photos', 'com.apple.mobileslideshow', 'photos', 'com.apple.camera', 'camera', 'com.google.photos']),
  ...r('life', 'Health & fitness', [
    'com.apple.health', 'com.apple.fitness', 'com.strava.stravaride', 'strava', 'com.onepeloton',
    'com.whoop.iphone', 'com.ouraring.oura', 'com.myfitnesspal', 'com.calm.calmapp', 'com.getsomeheadspace.headspace',
    'com.functionhealth', 'com.nike.omega', 'com.garmin.connect.mobile',
  ]),
  ...r('life', 'Out & about', [
    'com.apple.maps', 'com.google.maps', 'com.waze.iphone', 'waze', 'maps', 'com.ubercab.ubercab', 'com.zimride.instant',
    'com.ubercab.ubereats', 'doordash.doordashconsumer', 'com.opentable', 'com.resy', 'com.airbnb.app',
    'com.apple.weather', 'weather', 'com.apple.mobiletimer', 'clock', 'com.apple.passbook',
  ]),
  // --- not counted ---
  ...r('ignore', 'System', [
    'wdmtg.none', 'com.apple.springboard', 'com.apple.loginwindow', 'loginwindow', 'com.apple.screensaver',
    'screensaverengine', 'com.apple.screensaver.engine', 'lockapp.exe', 'com.apple.carplay',
    'com.apple.dock', 'com.apple.controlcenter', 'com.apple.notificationcenterui',
    'com.apple.spotlight', 'com.apple.incallservice', 'com.apple.sleeplockscreen', 'com.apple.usernotificationsui',
  ]),
];

/** Browsers: we look at the page, not the app. */
export const BROWSERS = [
  'com.apple.safari', 'com.apple.mobilesafari', 'com.google.chrome', 'com.google.chrome.ios',
  'org.mozilla.firefox', 'org.mozilla.ios.firefox', 'com.microsoft.edgemac', 'com.brave.browser',
  'company.thebrowser.browser', 'company.thebrowser.dia', 'com.operasoftware.opera', 'com.vivaldi.vivaldi',
  'com.duckduckgo.macos.browser', 'com.duckduckgo.mobile.ios', 'ai.perplexity.comet', 'com.openai.atlas',
  'safari', 'google chrome', 'chrome', 'chrome.exe', 'firefox', 'firefox.exe', 'microsoft edge', 'msedge.exe',
  'brave browser', 'brave.exe', 'arc', 'opera',
];

/** When the browser does not give us an address, these words in the tab title identify the site. */
export const TITLE_HINTS = [
  ['youtube studio', 'studio.youtube.com'], ['youtube', 'youtube.com'], ['instagram', 'instagram.com'],
  ['tiktok', 'tiktok.com'], ['facebook', 'facebook.com'], ['reddit', 'reddit.com'], ['netflix', 'netflix.com'],
  ['linkedin', 'linkedin.com'], ['gmail', 'mail.google.com'], ['inbox (', 'mail.google.com'],
  ['google sheets', 'docs.google.com/spreadsheets'], ['zillow', 'zillow.com'], ['redfin', 'redfin.com'],
  ['realtor.com', 'realtor.com'], ['propstream', 'propstream.com'], ['slack', 'slack.com'], ['canva', 'canva.com'],
  ['kajabi', 'kajabi.com'], ['quickbooks', 'quickbooks.intuit.com'], ['amazon.com', 'amazon.com'],
  ['google calendar', 'calendar.google.com'], ['google meet', 'meet.google.com'], ['/ x', 'x.com'],
  ['twitch', 'twitch.tv'], ['espn', 'espn.com'], ['pandadoc', 'pandadoc.com'], ['docusign', 'docusign.com'],
  ['google drive', 'drive.google.com'], ['biggerpockets', 'biggerpockets.com'], ['whatsapp', 'web.whatsapp.com'],
];

/** Friendly names for common iPhone apps (the phone only reports ids). */
export const IOS_NAMES = {
  'com.burbn.instagram': 'Instagram', 'com.zhiliaoapp.musically': 'TikTok', 'com.facebook.Facebook': 'Facebook',
  'com.atebits.Tweetie2': 'X', 'com.burbn.barcelona': 'Threads', 'com.reddit.Reddit': 'Reddit',
  'com.toyopagroup.picaboo': 'Snapchat', 'com.linkedin.LinkedIn': 'LinkedIn', 'com.google.ios.youtube': 'YouTube',
  'com.netflix.Netflix': 'Netflix', 'com.apple.mobilesafari': 'Safari', 'com.google.chrome.ios': 'Chrome',
  'com.apple.MobileSMS': 'Messages', 'com.apple.mobilemail': 'Mail', 'com.google.Gmail': 'Gmail',
  'com.apple.mobilephone': 'Phone', 'com.apple.facetime': 'FaceTime', 'net.whatsapp.WhatsApp': 'WhatsApp',
  'com.tinyspeck.chatlyio': 'Slack', 'com.apple.Maps': 'Maps', 'com.google.Maps': 'Google Maps',
  'com.apple.mobileslideshow': 'Photos', 'com.apple.camera': 'Camera', 'com.apple.mobilecal': 'Calendar',
  'com.apple.mobilenotes': 'Notes', 'com.apple.reminders': 'Reminders', 'com.apple.Music': 'Music',
  'com.spotify.client': 'Spotify', 'com.apple.podcasts': 'Podcasts', 'com.apple.Preferences': 'Settings',
  'com.apple.AppStore': 'App Store', 'com.apple.news': 'News', 'com.apple.stocks': 'Stocks',
  'com.apple.weather': 'Weather', 'com.apple.Health': 'Health', 'com.apple.Fitness': 'Fitness',
  'com.zillow.ZillowMap': 'Zillow', 'com.redfin.Redfin': 'Redfin', 'com.move.Realtor': 'Realtor.com',
  'com.amazon.Amazon': 'Amazon', 'com.openai.chat': 'ChatGPT', 'com.anthropic.claude': 'Claude',
  'com.google.ios.youtubecreator': 'YouTube Studio', 'com.lemon.lvoverseas': 'CapCut', 'com.canva.canvaeditor': 'Canva',
  'us.zoom.videomeetings': 'Zoom', 'com.facebook.Messenger': 'Messenger', 'ph.telegra.Telegraph': 'Telegram',
  'com.hammerandchisel.discord': 'Discord', 'com.apple.DocumentsApp': 'Files', 'com.apple.mobiletimer': 'Clock',
  'com.apple.calculator': 'Calculator', 'com.apple.Passbook': 'Wallet', 'com.apple.findmy': 'Find My',
  'com.waze.iphone': 'Waze', 'com.ubercab.UberClient': 'Uber', 'com.apple.VoiceMemos': 'Voice Memos',
  'com.apple.shortcuts': 'Shortcuts', 'com.apple.iBooks': 'Books', 'com.amazon.Lassen': 'Kindle',
  'com.apple.tv': 'Apple TV', 'com.google.Docs': 'Google Docs', 'com.google.Sheets': 'Google Sheets',
  'com.google.Drive': 'Google Drive', 'com.getdropbox.Dropbox': 'Dropbox', 'notion.id': 'Notion',
  'com.intuit.QBOiPhone': 'QuickBooks', 'com.paypal.PPClient': 'PayPal', 'com.kajabi.mobile': 'Kajabi',
  'com.apple.springboard': 'Home screen', 'com.openphone': 'Quo', 'com.docusign.DocuSignIt': 'DocuSign',
  'com.robinhood.release.Robinhood': 'Robinhood', 'com.espn.ScoreCenter': 'ESPN',
};
