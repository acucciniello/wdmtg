// Believable sample data, used for the demo mode, screenshots and tests.
import { dayStart, dateString, MIN, HOUR } from './timeline.js';

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const chrome = (title, url) => ({ app: 'Google Chrome', bundle: 'com.google.Chrome', title, url });
const MAC = {
  email: [chrome('Inbox (14) - Gmail', 'https://mail.google.com/mail/u/0/#inbox'), { app: 'Mail', bundle: 'com.apple.mail', title: 'Inbox' }],
  chat: [{ app: 'Slack', bundle: 'com.tinyspeck.slackmacgap', title: 'team - Slack' }, { app: 'Messages', bundle: 'com.apple.MobileSMS', title: 'Messages' }],
  deals: [
    chrome('3 bd in Columbus OH | Zillow', 'https://www.zillow.com/homes/columbus-oh'),
    chrome('PropStream', 'https://app.propstream.com/search'),
    chrome('Deal analyzer - Google Sheets', 'https://docs.google.com/spreadsheets/d/abc/edit'),
    chrome('Offer - PandaDoc', 'https://app.pandadoc.com/a/#/documents'),
  ],
  content: [
    { app: 'CapCut', bundle: 'com.lemon.lvoverseas', title: 'Reel - first rental' },
    { app: 'Descript', bundle: 'com.descript.beachcube', title: 'Episode 41' },
    chrome('Thumbnail - Canva', 'https://www.canva.com/design/xyz'),
    chrome('Channel content - YouTube Studio', 'https://studio.youtube.com/channel/abc'),
  ],
  admin: [
    { app: 'Finder', bundle: 'com.apple.finder', title: 'Downloads' },
    chrome('QuickBooks', 'https://qbo.intuit.com/app/homepage'),
    chrome('Google Calendar', 'https://calendar.google.com/calendar/u/0/r'),
    chrome('My Drive - Google Drive', 'https://drive.google.com/drive/my-drive'),
  ],
  lost: [
    chrome('YouTube', 'https://www.youtube.com/watch?v=abc'),
    chrome('Home / X', 'https://x.com/home'),
    chrome('Instagram', 'https://www.instagram.com/'),
    chrome('ESPN', 'https://www.espn.com/nfl/'),
    chrome('Amazon.com', 'https://www.amazon.com/s?k=desk'),
  ],
  unsorted: [
    { app: 'Notion', bundle: 'notion.id', title: 'Content calendar' },
    chrome('ChatGPT', 'https://chatgpt.com/'),
    { app: 'Notes', bundle: 'com.apple.Notes', title: 'Ideas' },
  ],
};
const PHONE = {
  lost: [['com.burbn.instagram', 'Instagram'], ['com.zhiliaoapp.musically', 'TikTok'], ['com.google.ios.youtube', 'YouTube'], ['com.atebits.Tweetie2', 'X']],
  busy: [['com.apple.MobileSMS', 'Messages'], ['com.apple.mobilemail', 'Mail'], ['com.tinyspeck.chatlyio', 'Slack']],
  money: [['com.zillow.ZillowMap', 'Zillow'], ['com.kajabi.mobile', 'Kajabi']],
};
const PEOPLE = ['Mike Russo', 'Dana (agent)', 'Chris Lender', 'Mom', '(614) 555-0142', 'Sam Contractor'];

/** Fill the store with `days` days ending today. */
export function seedDemo(store, { days = 8, now = Date.now(), seed = 7 } = {}) {
  const rand = rng(seed);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const between = (a, b) => a + rand() * (b - a);
  const segs = [];
  let n = 0;
  const push = (s) => {
    if (s.end > now) s.end = now;
    if (s.end - s.start >= 1000) segs.push({ ...s, extId: `demo:${n++}` });
  };

  const macBlock = (from, to, mix, { pickupEvery = 18 } = {}) => {
    let t = from;
    let nextPickup = from + between(6, pickupEvery) * MIN;
    while (t < to) {
      const roll = rand();
      let acc = 0;
      let kind = mix[0][0];
      for (const [k, w] of mix) {
        acc += w;
        if (roll <= acc) { kind = k; break; }
      }
      const short = kind === 'email' || kind === 'chat' || kind === 'admin';
      const len = (short ? between(0.4, 3.5) : kind === 'lost' ? between(2, 14) : between(3, 16)) * MIN;
      const end = Math.min(to, t + len);
      push({ source: 'mac', device: 'MacBook Pro', start: t, end, ...pick(MAC[kind]) });
      t = end;
      if (t >= nextPickup && t < to) {
        // Phone comes out mid-work; the laptop sits idle meanwhile.
        const plen = between(1, 7) * MIN;
        const [bundle, app] = pick(rand() < 0.75 ? PHONE.lost : PHONE.busy);
        const pend = Math.min(to, t + plen);
        push({ source: 'iphone', device: 'iPhone', start: t + 5000, end: pend, app, bundle });
        push({ source: 'mac', device: 'MacBook Pro', start: t, end: pend, idle: true, ...pick(MAC.admin) });
        t = pend;
        nextPickup = t + between(8, pickupEvery * 1.6) * MIN;
      }
    }
  };

  const phoneBlock = (from, to, kinds) => {
    let t = from;
    while (t < to) {
      const [bundle, app] = pick(PHONE[pick(kinds)]);
      const end = Math.min(to, t + between(1.5, 11) * MIN);
      push({ source: 'iphone', device: 'iPhone', start: t, end, app, bundle });
      t = end + between(2, 20) * 1000;
    }
  };

  const call = (start, minutes, who) =>
    push({ source: 'call', device: 'Phone', start, end: start + minutes * MIN, app: 'Phone', bundle: 'com.apple.Telephony', title: who });

  const today = dayStart(dateString(now));
  for (let d = days - 1; d >= 0; d--) {
    const day = dayStart(dateString(today - d * 24 * HOUR + 12 * HOUR));
    const at = (h, m = 0) => day + h * HOUR + m * MIN + between(-6, 6) * MIN;
    const weekend = [0, 6].includes(new Date(day).getDay());

    phoneBlock(at(6, 50), at(7, 20), ['lost', 'busy']);
    if (weekend) {
      phoneBlock(at(10), at(10, 50), ['lost']);
      macBlock(at(11), at(12, 10), [['email', 0.3], ['lost', 0.4], ['admin', 0.3]]);
      push({ source: 'manual', device: 'iPhone', start: at(13), end: at(16, 30), title: 'Family time', bucket: 'life' });
      phoneBlock(at(21), at(22, 15), ['lost']);
      continue;
    }
    push({ source: 'manual', device: 'iPhone', start: at(7, 30), end: at(8, 20), title: 'Gym', bucket: 'life' });

    // Morning: meant for deals, eaten by email and chat.
    macBlock(at(8, 40), at(12, 20), [['email', 0.3], ['chat', 0.18], ['admin', 0.18], ['deals', 0.13], ['lost', 0.11], ['unsorted', 0.05], ['content', 0.05]]);
    call(at(10, 5), between(9, 26), pick(PEOPLE));
    phoneBlock(at(12, 30), at(13, 5), ['lost']);

    // Afternoon: content, a property visit, more inbox.
    macBlock(at(13, 20), at(14, 50), [['content', 0.36], ['email', 0.24], ['chat', 0.16], ['lost', 0.14], ['unsorted', 0.1]]);
    if (d % 2 === 0) {
      push({ source: 'motion', device: 'iPhone', start: at(15), end: at(15, 28), title: 'Driving' });
      push({ source: 'manual', device: 'iPhone', start: at(15, 30), end: at(16, 15), title: 'Property walkthrough', bucket: 'money' });
      call(at(15, 5), between(8, 18), pick(PEOPLE));
      push({ source: 'motion', device: 'iPhone', start: at(16, 18), end: at(16, 45), title: 'Driving' });
    } else {
      macBlock(at(15), at(16, 40), [['deals', 0.26], ['email', 0.26], ['admin', 0.22], ['lost', 0.14], ['chat', 0.12]]);
      call(at(15, 40), between(12, 34), pick(PEOPLE));
    }
    macBlock(at(16, 50), at(17, 45), [['email', 0.3], ['admin', 0.3], ['chat', 0.2], ['lost', 0.2]]);
    call(at(17, 10), between(4, 12), 'Mom');

    phoneBlock(at(18, 40), at(19, 10), ['lost', 'busy']);
    if (d % 3 !== 0) macBlock(at(20, 30), at(21, 35), [['email', 0.35], ['admin', 0.35], ['deals', 0.15], ['lost', 0.15]], { pickupEvery: 30 });
    phoneBlock(at(22), at(22, 50), ['lost']);
  }
  const past = segs.filter((s) => s.start < now);
  store.upsertMany(past);
  return past.length;
}
