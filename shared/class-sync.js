/**
 * class-sync.js (v2.0)
 * Universal schedule parsing, time-matching, unit translation,
 * and canonical curriculum adapter/loader.
 * Shared across Phonics Flash, Word-Tac-Toe, MatchMaker, and Treasure Hunt.
 */
(function (root, factory) {
  const lib = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = lib;
  }
  if (typeof root !== 'undefined') {
    root.SharedClassSync = lib;
  }
  if (typeof window !== 'undefined') {
    window.SharedClassSync = lib;
  }
})(typeof self !== 'undefined' ? self : this, function () {

  const SHARED_SETS_KEY = 'shared_player_sets';
  const SHARED_ACTIVE_PLAYERS_KEY = 'shared_active_players';
  const SHARED_ACTIVE_CLASS_KEY = 'shared_active_class';
  const SHARED_CLASS_PROFILES_KEY = 'shared_class_profiles';
  const SHARED_HIDDEN_BOOKS_KEY = 'shared_hidden_books';
  const SHARED_COOKIE_NAME = 'ae_shared_sync';
  const UPSTASH_URL_KEY = 'upstash_redis_url';
  const UPSTASH_TOKEN_KEY = 'upstash_redis_token';
  const UPSTASH_SHARED_CURRICULUM_KEY = 'shared_phonics_curriculum';
  const ELEVENLABS_KEY = 'elevenlabs_api_key';
  const PHONICS_FLASH_ELEVENLABS_KEY = 'phonics-flash-elevenlabs-key';
  
  function getMediaBase() {
    if (typeof window !== 'undefined') {
      if (window.ALL_ENGLISH_MEDIA_BASE) return window.ALL_ENGLISH_MEDIA_BASE;
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('all_english_media_base');
        if (stored) return stored;
      }
    }
    return 'https://all-english-media.allenglish.link';
  }

  const DEFAULT_MEDIA_BASE = getMediaBase();

  // ── 1. Schedule Parsing from Class Name ────────────────────────
  const DAY_PATTERNS = [
    { pattern: /\bMWF\b/i, days: ['Mon', 'Wed', 'Fri'] },
    { pattern: /\b(TTh|TuTh|TT)\b/i, days: ['Tue', 'Thu'] },
    { pattern: /\bWF\b/i, days: ['Wed', 'Fri'] },
    { pattern: /\bMW\b/i, days: ['Mon', 'Wed'] },
    { pattern: /\bMon(day)?\b/i, days: ['Mon'] },
    { pattern: /\bTue(s|sday)?\b/i, days: ['Tue'] },
    { pattern: /\bWed(nesday)?\b/i, days: ['Wed'] },
    { pattern: /\bThu(r|rs|rsday)?\b/i, days: ['Thu'] },
    { pattern: /\bFri(day)?\b/i, days: ['Fri'] },
    { pattern: /\bSat(urday)?\b/i, days: ['Sat'] },
    { pattern: /\bSun(day)?\b/i, days: ['Sun'] }
  ];

  function parseScheduleFromName(className) {
    if (!className || typeof className !== 'string') {
      return { days: ['Mon', 'Wed', 'Fri'], startTime: '15:00', endTime: '16:00' };
    }

    // 1. Extract Days
    let matchedDays = null;
    for (const entry of DAY_PATTERNS) {
      if (entry.pattern.test(className)) {
        matchedDays = entry.days;
        break;
      }
    }
    if (!matchedDays) {
      matchedDays = ['Mon', 'Wed', 'Fri'];
    }

    // 2. Extract Start Time
    const timeMatch = className.match(/(\d{1,2}):(\d{2})/);
    let startHour = 15;
    let startMin = 0;

    if (timeMatch) {
      startHour = parseInt(timeMatch[1], 10);
      startMin = parseInt(timeMatch[2], 10);
      // Auto-convert single-digit or early morning afternoon times (e.g. 3:00 -> 15:00)
      if (startHour >= 1 && startHour <= 8) {
        startHour += 12;
      }
    }

    const pad = n => String(n).padStart(2, '0');
    const startTime = `${pad(startHour)}:${pad(startMin)}`;

    // Default 50-60 min session length
    const totalStartMinutes = startHour * 60 + startMin;
    const totalEndMinutes = totalStartMinutes + 50;
    const endHour = Math.floor(totalEndMinutes / 60);
    const endMin = totalEndMinutes % 60;
    const endTime = `${pad(endHour)}:${pad(endMin)}`;

    return { days: matchedDays, startTime, endTime };
  }

  // ── 2. Strict In-Session Time Matching ─────────────────────────
  function findActiveScheduledClass(classProfiles, date = new Date()) {
    if (!classProfiles || typeof classProfiles !== 'object') return null;

    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames[date.getDay()];
    const currentMinutes = date.getHours() * 60 + date.getMinutes();

    const candidates = [];

    for (const [className, profile] of Object.entries(classProfiles)) {
      const schedule = profile.schedule || parseScheduleFromName(className);
      if (!schedule || !Array.isArray(schedule.days) || !schedule.days.includes(currentDay)) {
        continue;
      }

      const startParts = (schedule.startTime || '00:00').split(':').map(Number);
      const endParts = (schedule.endTime || '23:59').split(':').map(Number);

      const startMin = (startParts[0] || 0) * 60 + (startParts[1] || 0);
      let endMin = (endParts[0] || 0) * 60 + (endParts[1] || 0);
      if (endMin <= startMin) {
        endMin = startMin + 60;
      }

      if (currentMinutes >= startMin && currentMinutes < endMin) {
        candidates.push({ className, profile, startMin, endMin });
      }
    }

    if (candidates.length === 0) return null;
    candidates.sort((a, b) => b.startMin - a.startMin);
    return candidates[0];
  }

  // ── 3. Universal Phonics Unit Translators & Slug Helpers ──────
  function toSeriesSlug(str) {
    if (!str) return 'smart-phonics';
    const s = String(str).trim();
    if (/^(?:SmartPhonics|SP)$/i.test(s)) return 'smart-phonics';
    if (/^(?:LetsSmile|LS)$/i.test(s)) return 'lets-smile';
    if (/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(s)) return s;
    return s
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/[\s_]+/g, '-')
      .toLowerCase();
  }

  function toPascalCase(str) {
    if (!str) return 'SmartPhonics';
    const s = String(str).trim();
    if (s === 'smart-phonics' || s.toLowerCase() === 'smart phonics') return 'SmartPhonics';
    if (s === 'lets-smile' || s.toLowerCase() === 'lets smile') return 'LetsSmile';
    return s
      .split(/[-_\s]+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
      .join('');
  }

  function toSeriesDisplayName(str) {
    if (!str) return 'Smart Phonics';
    const s = String(str).trim();
    if (/^(?:smart-phonics|smartphonics|sp)$/i.test(s)) return 'Smart Phonics';
    if (/^(?:lets-smile|letssmile|ls)$/i.test(s)) return "Let's Smile";
    return s
      .split(/[-_]+/)
      .map(w => w.charAt(0).toUpperCase() + w.slice(1))
      .join(' ');
  }

  function toCanonicalUnit(unitStr) {
    if (!unitStr) return null;

    // 1. Object format
    if (typeof unitStr === 'object') {
      const series = toSeriesSlug(unitStr.series || 'smart-phonics');
      const level = parseInt(unitStr.level || unitStr.book, 10);
      const unit = parseInt(unitStr.unit || (typeof unitStr.unitName === 'string' ? unitStr.unitName.match(/Unit\s+(\d+)/i)?.[1] : null), 10);
      if (!isNaN(level) && !isNaN(unit)) {
        return {
          series,
          seriesName: toSeriesDisplayName(series),
          level,
          unit,
          id: `${series}:L${level}U${unit}`
        };
      }
      return null;
    }

    if (typeof unitStr !== 'string') return null;
    const str = unitStr.trim();

    // 2. Three-part colon: <series>:level<lvl>:unit<unit> (e.g. jolly-phonics:level2:unit3)
    let m = str.match(/^([a-z0-9_-]+):level(\d+):unit(\d+)$/i);
    if (m) {
      const series = toSeriesSlug(m[1]);
      const level = parseInt(m[2], 10);
      const unit = parseInt(m[3], 10);
      return { series, seriesName: toSeriesDisplayName(series), level, unit, id: `${series}:L${level}U${unit}` };
    }

    // 3. Series-scoped canonical format: <series>:L<lvl>U<unit> (e.g. smart-phonics:L2U3 or jolly-phonics:L2U3)
    m = str.match(/^([a-z0-9_-]+):L(\d+)U(\d+)$/i);
    if (m) {
      const series = toSeriesSlug(m[1]);
      const level = parseInt(m[2], 10);
      const unit = parseInt(m[3], 10);
      return { series, seriesName: toSeriesDisplayName(series), level, unit, id: `${series}:L${level}U${unit}` };
    }

    // 4. Two-part colon: level<lvl>:unit<unit> (Treasure Hunt legacy) -> default smart-phonics
    m = str.match(/^level(\d+):unit(\d+)$/i);
    if (m) {
      const series = 'smart-phonics';
      const level = parseInt(m[1], 10);
      const unit = parseInt(m[2], 10);
      return { series, seriesName: toSeriesDisplayName(series), level, unit, id: `${series}:L${level}U${unit}` };
    }

    // 5. Pipe format:
    // 5a. 3-part pipe: <series>|<lvl>|<unit> or <series>|level<lvl>|unit<unit> or <series>|Book<lvl>|Unit<unit>
    const pipeParts = str.split('|');
    if (pipeParts.length === 3) {
      const sPart = pipeParts[0].trim();
      const lPart = pipeParts[1].replace(/^(?:Book|level|L)/i, '').trim();
      const uPart = pipeParts[2].replace(/^(?:Unit|U)/i, '').trim();
      const series = toSeriesSlug(sPart);
      const level = parseInt(lPart, 10);
      const unit = parseInt(uPart, 10);
      if (!isNaN(level) && !isNaN(unit)) {
        return { series, seriesName: toSeriesDisplayName(series), level, unit, id: `${series}:L${level}U${unit}` };
      }
    }

    // 5b. 2-part pipe: Book<lvl>|Unit<unit> or level<lvl>|unit<unit> or <lvl>|<unit> -> default smart-phonics
    if (pipeParts.length === 2) {
      const lPart = pipeParts[0].replace(/^(?:Book|level|L)/i, '').trim();
      const uPart = pipeParts[1].replace(/^(?:Unit|U)/i, '').trim();
      const level = parseInt(lPart, 10);
      const unit = parseInt(uPart, 10);
      if (!isNaN(level) && !isNaN(unit)) {
        const series = 'smart-phonics';
        return { series, seriesName: toSeriesDisplayName(series), level, unit, id: `${series}:L${level}U${unit}` };
      }
    }

    // 6. Bare canonical: L<lvl>U<unit> (Phonics Flash legacy) -> default smart-phonics
    m = str.match(/^L(\d+)U(\d+)$/i);
    if (m) {
      const series = 'smart-phonics';
      const level = parseInt(m[1], 10);
      const unit = parseInt(m[2], 10);
      return { series, seriesName: toSeriesDisplayName(series), level, unit, id: `${series}:L${level}U${unit}` };
    }

    return null;
  }

  function toPhonicsFlash(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    if (!c) return null;
    return c.series === 'smart-phonics' ? `L${c.level}U${c.unit}` : `${c.series}:L${c.level}U${c.unit}`;
  }

  function toTicTacToe(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    if (!c) return null;
    return c.series === 'smart-phonics' ? `level${c.level}|unit${c.unit}` : `${c.series}|level${c.level}|unit${c.unit}`;
  }

  function toMatchMaker(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    if (!c) return null;
    const prefix = toPascalCase(c.series);
    return `${prefix}|${c.level}|${c.unit}`;
  }

  function toTreasureHunt(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    if (!c) return null;
    return c.series === 'smart-phonics' ? `level${c.level}:unit${c.unit}` : `${c.series}:level${c.level}:unit${c.unit}`;
  }

  function getHighestUnit(unitsArray) {
    if (!Array.isArray(unitsArray) || unitsArray.length === 0) return null;
    const parsed = unitsArray.map(toCanonicalUnit).filter(Boolean);
    if (parsed.length === 0) return null;

    parsed.sort((a, b) => {
      if (a.series !== b.series) return a.series.localeCompare(b.series);
      if (b.level !== a.level) return b.level - a.level;
      return b.unit - a.unit;
    });

    return parsed[0];
  }

  // ── 4. Cross-Domain Cookie & Upstash REST API Helper ─────────
  const KNOWN_CC_SLDS = ['co.kr', 'ac.kr', 'ne.kr', 'or.kr', 're.kr', 'co.uk', 'com.au', 'co.jp', 'com.sg'];

  function getRootDomain(customHost) {
    let hostname = customHost;
    if (!hostname && typeof window !== 'undefined' && window.location) {
      hostname = window.location.hostname;
    }
    if (!hostname || hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1') {
      return null;
    }
    // Public Suffix List check: netlify.app, github.io cannot take wildcard cookies
    if (hostname.endsWith('.netlify.app') || hostname.endsWith('.github.io') || hostname.endsWith('.pages.dev') || hostname.endsWith('.vercel.app')) {
      return null;
    }
    const parts = hostname.toLowerCase().split('.');
    if (parts.length < 2) return null;

    const tail2 = parts.slice(-2).join('.');
    if (KNOWN_CC_SLDS.includes(tail2)) {
      if (parts.length >= 3) {
        return '.' + parts.slice(-3).join('.');
      }
      return null;
    }
    return '.' + tail2;
  }

  function readCookie(name) {
    if (typeof document === 'undefined') return null;
    try {
      const match = document.cookie.match(new RegExp('(?:^|; )' + name.replace(/([.$?*|{}()\[\]\\\/+^])/g, '\\$1') + '=([^;]*)'));
      return match ? decodeURIComponent(match[1]) : null;
    } catch {
      return null;
    }
  }

  function writeCookie(name, value, { days = 365, domain = null, path = '/' } = {}) {
    if (typeof document === 'undefined') return false;
    try {
      let cookieStr = `${encodeURIComponent(name)}=${encodeURIComponent(value)}; path=${path}`;
      if (days) {
        const maxAge = days * 24 * 60 * 60;
        cookieStr += `; max-age=${maxAge}`;
      }
      if (domain) {
        cookieStr += `; domain=${domain}`;
      }
      if (typeof location !== 'undefined' && location.protocol === 'https:') {
        cookieStr += '; secure';
      }
      cookieStr += '; samesite=lax';

      document.cookie = cookieStr;
      return true;
    } catch (e) {
      console.warn('[SharedClassSync] Failed to write cookie:', e);
      return false;
    }
  }

  function deleteCookie(name, { domain = null, path = '/' } = {}) {
    if (typeof document === 'undefined') return;
    try {
      let cookieStr = `${encodeURIComponent(name)}=; path=${path}; max-age=0; expires=Thu, 01 Jan 1970 00:00:00 GMT`;
      if (domain) {
        cookieStr += `; domain=${domain}`;
      }
      if (typeof location !== 'undefined' && location.protocol === 'https:') {
        cookieStr += '; secure';
      }
      cookieStr += '; samesite=lax';
      document.cookie = cookieStr;
    } catch (e) {
      console.warn('[SharedClassSync] Failed to delete cookie:', e);
    }
  }

  function readSharedSyncCookie() {
    try {
      const raw = readCookie(SHARED_COOKIE_NAME);
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return parsed;
      }
    } catch (e) {
      console.warn('[SharedClassSync] Failed to parse sync cookie:', e);
    }
    return null;
  }

  function writeSharedSyncCookie(updates = {}) {
    try {
      const existing = readSharedSyncCookie() || {};
      const merged = {
        ...existing,
        ...updates,
        updatedAt: Date.now()
      };

      for (const key of Object.keys(merged)) {
        if (merged[key] === null || merged[key] === undefined) {
          delete merged[key];
        }
      }

      const json = JSON.stringify(merged);
      if (encodeURIComponent(json).length > 3500) {
        console.warn('[SharedClassSync] Cookie payload too large, skipping cookie write');
        return null;
      }
      const rootDomain = getRootDomain();
      writeCookie(SHARED_COOKIE_NAME, json, {
        days: 365,
        domain: rootDomain || undefined,
        path: '/'
      });
      return merged;
    } catch (e) {
      console.warn('[SharedClassSync] Failed to write sync cookie:', e);
      return null;
    }
  }

  function saveCredentials(url, token) {
    const cleanUrl = (url || '').trim().replace(/\/$/, '');
    const cleanToken = (token || '').trim();

    if (typeof localStorage !== 'undefined') {
      if (cleanUrl && cleanToken) {
        localStorage.setItem(UPSTASH_URL_KEY, cleanUrl);
        localStorage.setItem(UPSTASH_TOKEN_KEY, cleanToken);
      } else {
        localStorage.removeItem(UPSTASH_URL_KEY);
        localStorage.removeItem(UPSTASH_TOKEN_KEY);
      }
    }

    if (cleanUrl && cleanToken) {
      writeSharedSyncCookie({ uUrl: cleanUrl, uTok: cleanToken });
    } else {
      const cookie = readSharedSyncCookie();
      if (cookie) {
        delete cookie.uUrl;
        delete cookie.uTok;
        cookie.updatedAt = Date.now();
        const rootDomain = getRootDomain();
        writeCookie(SHARED_COOKIE_NAME, JSON.stringify(cookie), {
          days: 365,
          domain: rootDomain || undefined,
          path: '/'
        });
      }
    }
    return { url: cleanUrl, token: cleanToken };
  }

  function clearCredentials() {
    return saveCredentials('', '');
  }

  function getSharedApiKey() {
    let key = '';
    if (typeof localStorage !== 'undefined') {
      key = localStorage.getItem(ELEVENLABS_KEY) || localStorage.getItem(PHONICS_FLASH_ELEVENLABS_KEY) || '';
    }
    if (!key) {
      const cookie = readSharedSyncCookie();
      if (cookie && cookie.elKey) {
        key = cookie.elKey;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(ELEVENLABS_KEY, key);
            localStorage.setItem(PHONICS_FLASH_ELEVENLABS_KEY, key);
          } catch {}
        }
      }
    }
    return key;
  }

  function setSharedApiKey(key) {
    const cleanKey = (key || '').trim();
    if (typeof localStorage !== 'undefined') {
      if (cleanKey) {
        localStorage.setItem(ELEVENLABS_KEY, cleanKey);
        localStorage.setItem(PHONICS_FLASH_ELEVENLABS_KEY, cleanKey);
      } else {
        localStorage.removeItem(ELEVENLABS_KEY);
        localStorage.removeItem(PHONICS_FLASH_ELEVENLABS_KEY);
      }
    }

    if (cleanKey) {
      writeSharedSyncCookie({ elKey: cleanKey });
    } else {
      const cookie = readSharedSyncCookie();
      if (cookie) {
        delete cookie.elKey;
        cookie.updatedAt = Date.now();
        const rootDomain = getRootDomain();
        writeCookie(SHARED_COOKIE_NAME, JSON.stringify(cookie), {
          days: 365,
          domain: rootDomain || undefined,
          path: '/'
        });
      }
    }
    return cleanKey;
  }

  function reconcileCookieWithLocalStorage() {
    if (typeof localStorage === 'undefined') return;

    let cookie = readSharedSyncCookie();

    const localUrl = localStorage.getItem(UPSTASH_URL_KEY) || '';
    const localToken = localStorage.getItem(UPSTASH_TOKEN_KEY) || '';
    const localElKey = localStorage.getItem(ELEVENLABS_KEY) || localStorage.getItem(PHONICS_FLASH_ELEVENLABS_KEY) || '';
    let localHidden = [];
    try {
      const stored = localStorage.getItem(SHARED_HIDDEN_BOOKS_KEY);
      if (stored) localHidden = JSON.parse(stored) || [];
    } catch {}

    let localActive = [];
    try {
      const storedAct = localStorage.getItem(SHARED_ACTIVE_PLAYERS_KEY);
      if (storedAct) localActive = JSON.parse(storedAct) || [];
    } catch {}

    let localActiveClass = '';
    try {
      localActiveClass = localStorage.getItem(SHARED_ACTIVE_CLASS_KEY) || '';
    } catch {}

    const updatesForCookie = {};
    let cookieChanged = false;

    if (cookie) {
      if (cookie.uUrl && cookie.uTok && (!localUrl || !localToken)) {
        try {
          localStorage.setItem(UPSTASH_URL_KEY, cookie.uUrl);
          localStorage.setItem(UPSTASH_TOKEN_KEY, cookie.uTok);
        } catch {}
      } else if (localUrl && localToken && (!cookie.uUrl || !cookie.uTok)) {
        updatesForCookie.uUrl = localUrl;
        updatesForCookie.uTok = localToken;
        cookieChanged = true;
      }

      if (cookie.elKey && !localElKey) {
        try {
          localStorage.setItem(ELEVENLABS_KEY, cookie.elKey);
          localStorage.setItem(PHONICS_FLASH_ELEVENLABS_KEY, cookie.elKey);
        } catch {}
      } else if (localElKey && !cookie.elKey) {
        updatesForCookie.elKey = localElKey;
        cookieChanged = true;
      }

      if (Array.isArray(cookie.hidden) && cookie.hidden.length > 0) {
        const mergedHidden = Array.from(new Set([...localHidden, ...cookie.hidden]));
        if (mergedHidden.length !== localHidden.length) {
          try {
            localStorage.setItem(SHARED_HIDDEN_BOOKS_KEY, JSON.stringify(mergedHidden));
          } catch {}
        }
        if (mergedHidden.length !== cookie.hidden.length) {
          updatesForCookie.hidden = mergedHidden;
          cookieChanged = true;
        }
      } else if (localHidden.length > 0) {
        updatesForCookie.hidden = localHidden;
        cookieChanged = true;
      }

      if (Array.isArray(cookie.act) && cookie.act.length > 0 && localActive.length === 0) {
        try {
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(cookie.act));
        } catch {}
      } else if (localActive.length > 0 && (!cookie.act || cookie.act.length === 0)) {
        updatesForCookie.act = localActive;
        cookieChanged = true;
      }

      if (cookie.actClass && !localActiveClass) {
        try {
          localStorage.setItem(SHARED_ACTIVE_CLASS_KEY, cookie.actClass);
        } catch {}
      } else if (localActiveClass && !cookie.actClass) {
        updatesForCookie.actClass = localActiveClass;
        cookieChanged = true;
      }
    } else {
      if (localUrl && localToken) {
        updatesForCookie.uUrl = localUrl;
        updatesForCookie.uTok = localToken;
        cookieChanged = true;
      }
      if (localElKey) {
        updatesForCookie.elKey = localElKey;
        cookieChanged = true;
      }
      if (localHidden.length > 0) {
        updatesForCookie.hidden = localHidden;
        cookieChanged = true;
      }
      if (localActive.length > 0) {
        updatesForCookie.act = localActive;
        cookieChanged = true;
      }
      if (localActiveClass) {
        updatesForCookie.actClass = localActiveClass;
        cookieChanged = true;
      }
    }

    if (cookieChanged) {
      writeSharedSyncCookie(updatesForCookie);
    }
  }

  function getCredentials() {
    let url = '';
    let token = '';

    if (typeof localStorage !== 'undefined') {
      url = localStorage.getItem(UPSTASH_URL_KEY) || '';
      token = localStorage.getItem(UPSTASH_TOKEN_KEY) || '';
    }

    if (!url || !token) {
      const cookie = readSharedSyncCookie();
      if (cookie && cookie.uUrl && cookie.uTok) {
        url = cookie.uUrl;
        token = cookie.uTok;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(UPSTASH_URL_KEY, url);
            localStorage.setItem(UPSTASH_TOKEN_KEY, token);
          } catch {}
        }
      }
    }

    if (!url && typeof window !== 'undefined' && window.UPSTASH_CONFIG) {
      url = window.UPSTASH_CONFIG.url || '';
      token = window.UPSTASH_CONFIG.token || '';
    }

    if (url && url.endsWith('/')) {
      url = url.slice(0, -1);
    }

    return { url, token };
  }

  async function fetchUpstash(key) {
    const { url, token } = getCredentials();
    if (!url || !token) return null;

    try {
      const res = await fetch(`${url}/get/${encodeURIComponent(key)}`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (!data || data.result === null || data.result === undefined) return null;

      if (typeof data.result === 'string') {
        try {
          return JSON.parse(data.result);
        } catch {
          return data.result;
        }
      }
      return data.result;
    } catch (err) {
      console.warn(`[SharedClassSync] Fetch error for key "${key}":`, err);
      return null;
    }
  }

  async function syncUpstash(key, value) {
    const { url, token } = getCredentials();
    if (!url || !token) return false;

    try {
      const payload = typeof value === 'string' ? value : JSON.stringify(value);
      const res = await fetch(`${url}/set/${encodeURIComponent(key)}`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: payload
      });
      return res.ok;
    } catch (err) {
      console.warn(`[SharedClassSync] Sync error for key "${key}":`, err);
      return false;
    }
  }

  // ── 5. Unified Profile Loader & Manager ────────────────────────
  async function loadAllClasses() {
    let playerSets = {};
    let classProfiles = {};

    if (typeof localStorage !== 'undefined') {
      try {
        const localSets = localStorage.getItem(SHARED_SETS_KEY);
        if (localSets) playerSets = JSON.parse(localSets) || {};
        const localProfiles = localStorage.getItem(SHARED_CLASS_PROFILES_KEY);
        if (localProfiles) classProfiles = JSON.parse(localProfiles) || {};
      } catch (e) {
        console.warn('[SharedClassSync] Error reading local storage:', e);
      }
    }

    const cloudSets = await fetchUpstash(SHARED_SETS_KEY);
    if (cloudSets && typeof cloudSets === 'object') {
      playerSets = cloudSets;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARED_SETS_KEY, JSON.stringify(cloudSets));
      }
    }

    const cloudProfiles = await fetchUpstash(SHARED_CLASS_PROFILES_KEY);
    if (cloudProfiles && typeof cloudProfiles === 'object') {
      classProfiles = cloudProfiles;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(cloudProfiles));
      }
    }

    try {
      const cloudHidden = await fetchUpstash(SHARED_HIDDEN_BOOKS_KEY);
      if (Array.isArray(cloudHidden)) {
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SHARED_HIDDEN_BOOKS_KEY, JSON.stringify(cloudHidden));
        }
        writeSharedSyncCookie({ hidden: cloudHidden });
      }
    } catch (e) {
      console.warn('[SharedClassSync] Error fetching cloud hidden books:', e);
    }

    let profilesChanged = false;
    for (const className of Object.keys(playerSets)) {
      if (!classProfiles[className]) {
        classProfiles[className] = {
          schedule: parseScheduleFromName(className),
          units: [],
          updatedAt: Date.now()
        };
        profilesChanged = true;
      } else if (!classProfiles[className].schedule) {
        classProfiles[className].schedule = parseScheduleFromName(className);
        profilesChanged = true;
      }
    }

    if (profilesChanged) {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(classProfiles));
      }
      syncUpstash(SHARED_CLASS_PROFILES_KEY, classProfiles);
    }

    return { playerSets, classProfiles };
  }

  async function saveClassUnits(className, canonicalUnitsArray, curriculumId) {
    if (!className) return false;
    let profiles = {};
    if (typeof localStorage !== 'undefined') {
      try {
        profiles = JSON.parse(localStorage.getItem(SHARED_CLASS_PROFILES_KEY) || '{}');
      } catch {}
    }

    if (!profiles[className]) {
      profiles[className] = {
        schedule: parseScheduleFromName(className),
        units: [],
        curriculumId: curriculumId || 'smart-phonics',
        updatedAt: Date.now()
      };
    }

    const series = curriculumId ? toSeriesSlug(curriculumId) : 'smart-phonics';
    const canonicals = (canonicalUnitsArray || []).map(u => {
      const c = toCanonicalUnit(u);
      if (c) {
        if (typeof u === 'string' && !u.includes(':') && series !== 'smart-phonics') {
          return `${series}:L${c.level}U${c.unit}`;
        }
        return c.id;
      }
      return u;
    });

    profiles[className].units = canonicals;
    if (curriculumId) {
      profiles[className].curriculumId = curriculumId;
    }
    profiles[className].updatedAt = Date.now();

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(profiles));
    }
    return syncUpstash(SHARED_CLASS_PROFILES_KEY, profiles);
  }

  // ── 5b. Book Visibility Management ────────────────────────────
  function getHiddenBooks() {
    let list = [];
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem(SHARED_HIDDEN_BOOKS_KEY);
        if (stored) list = JSON.parse(stored) || [];
      } catch {
        list = [];
      }
    }
    if (list.length === 0) {
      const cookie = readSharedSyncCookie();
      if (cookie && Array.isArray(cookie.hidden) && cookie.hidden.length > 0) {
        list = cookie.hidden;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(SHARED_HIDDEN_BOOKS_KEY, JSON.stringify(list));
          } catch {}
        }
      }
    }
    return list;
  }

  async function setHiddenBooks(hiddenSlugs) {
    const list = Array.isArray(hiddenSlugs)
      ? hiddenSlugs.map(toSeriesSlug).filter(Boolean)
      : [];
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_HIDDEN_BOOKS_KEY, JSON.stringify(list));
    }
    writeSharedSyncCookie({ hidden: list });
    return syncUpstash(SHARED_HIDDEN_BOOKS_KEY, list);
  }

  function isBookHidden(seriesId) {
    if (!seriesId) return false;
    const slug = toSeriesSlug(seriesId);
    return getHiddenBooks().includes(slug);
  }

  function getVisibleSeries(seriesEntries) {
    if (!seriesEntries) return [];
    const hidden = getHiddenBooks();

    if (Array.isArray(seriesEntries)) {
      const visible = seriesEntries.filter(entry => {
        const id = typeof entry === 'string' ? entry : (entry?.id || entry?.name || '');
        return !hidden.includes(toSeriesSlug(id));
      });
      if (visible.length === 0 && seriesEntries.length > 0) {
        return [seriesEntries[0]];
      }
      return visible;
    }

    if (typeof seriesEntries === 'object') {
      const visibleObj = {};
      let count = 0;
      for (const [key, val] of Object.entries(seriesEntries)) {
        const slug = toSeriesSlug(val?.id || key);
        if (!hidden.includes(slug)) {
          visibleObj[key] = val;
          count++;
        }
      }
      if (count === 0 && Object.keys(seriesEntries).length > 0) {
        const firstKey = Object.keys(seriesEntries)[0];
        visibleObj[firstKey] = seriesEntries[firstKey];
      }
      return visibleObj;
    }

    return seriesEntries;
  }

  // ── 5c. Active Session Players & Attendance Management ────────
  function getActivePlayers() {
    let list = [];
    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem(SHARED_ACTIVE_PLAYERS_KEY);
        if (stored) list = JSON.parse(stored) || [];
      } catch {
        list = [];
      }
    }
    if (list.length === 0) {
      const cookie = readSharedSyncCookie();
      if (cookie && Array.isArray(cookie.act) && cookie.act.length > 0) {
        list = cookie.act;
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(list));
          } catch {}
        }
      }
    }
    return list;
  }

  function getActiveSession() {
    const players = getActivePlayers();
    let className = '';
    if (typeof localStorage !== 'undefined') {
      try {
        className = localStorage.getItem(SHARED_ACTIVE_CLASS_KEY) || '';
      } catch {}
    }
    if (!className) {
      const cookie = readSharedSyncCookie();
      if (cookie && cookie.actClass) {
        className = cookie.actClass;
      }
    }
    const cookie = readSharedSyncCookie();
    const updatedAt = (cookie && cookie.updatedAt) || 0;
    return {
      players,
      className,
      updatedAt
    };
  }

  function saveActivePlayers(players, className = null) {
    let cleanPlayers = [];
    if (Array.isArray(players)) {
      cleanPlayers = players
        .map(p => typeof p === 'string' ? p.trim() : (p?.name ? String(p.name).trim() : ''))
        .filter(Boolean)
        .slice(0, 24);
    }

    let cleanClassName = typeof className === 'string' ? className.trim() : null;
    if (cleanClassName === null && typeof localStorage !== 'undefined') {
      cleanClassName = localStorage.getItem(SHARED_ACTIVE_CLASS_KEY) || null;
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(cleanPlayers));
    }

    if (cleanPlayers.length > 0) {
      const updates = { act: cleanPlayers };
      if (cleanClassName) {
        updates.actClass = cleanClassName;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SHARED_ACTIVE_CLASS_KEY, cleanClassName);
        }
        syncUpstash(SHARED_ACTIVE_CLASS_KEY, cleanClassName);
      }
      writeSharedSyncCookie(updates);
    } else {
      if (typeof localStorage !== 'undefined') {
        localStorage.removeItem(SHARED_ACTIVE_CLASS_KEY);
      }
      const cookie = readSharedSyncCookie();
      if (cookie) {
        delete cookie.act;
        delete cookie.actClass;
        cookie.updatedAt = Date.now();
        const rootDomain = getRootDomain();
        writeCookie(SHARED_COOKIE_NAME, JSON.stringify(cookie), {
          days: 365,
          domain: rootDomain || undefined,
          path: '/'
        });
      }
      syncUpstash(SHARED_ACTIVE_CLASS_KEY, '');
    }

    syncUpstash(SHARED_ACTIVE_PLAYERS_KEY, cleanPlayers);
    return cleanPlayers;
  }

  function clearActivePlayers() {
    return saveActivePlayers([], '');
  }

  function resolveClassRoster(className, defaultRoster = [], { maxAgeMs = 60 * 60 * 1000 } = {}) {
    if (!className || !Array.isArray(defaultRoster) || defaultRoster.length === 0) {
      return defaultRoster || [];
    }
    const session = getActiveSession();
    if (!session.players || session.players.length === 0) {
      return defaultRoster;
    }

    const isFresh = (Date.now() - session.updatedAt) < maxAgeMs;
    if (!isFresh) {
      return defaultRoster;
    }

    // Match 1: explicit class match
    if (session.className && session.className === className) {
      return session.players;
    }

    // Match 2: subset match (e.g. absent student removed in game 1 without explicit tag)
    const isSubset = session.players.length <= defaultRoster.length &&
      session.players.every(p => defaultRoster.includes(p));
    if (isSubset) {
      return session.players;
    }

    return defaultRoster;
  }

  // ── 6. Canonical Curriculum Adapter ───────────────────────────
  const CurriculumAdapter = {
    /**
     * Defensive Normalizer: accepts Canonical v2, EditorStore v1, or raw words.json
     * Returns a valid Canonical v2 structure: { version: 2, updatedAt, mediaBase, series: [...] }
     */
    normalize(data) {
      if (!data) return null;
      if (Array.isArray(data.series)) {
        return {
          version: data.version || 2,
          updatedAt: data.updatedAt || Date.now(),
          mediaBase: (data.mediaBase || DEFAULT_MEDIA_BASE).replace(/\/$/, ''),
          series: data.series
        };
      }
      // Legacy EditorStore format (has curricula[])
      if (Array.isArray(data.curricula)) {
        return {
          version: 2,
          updatedAt: data.updatedAt || Date.now(),
          mediaBase: (data.mediaBase || DEFAULT_MEDIA_BASE).replace(/\/$/, ''),
          series: data.curricula.map(c => ({
            id: c.id,
            name: c.name,
            levels: c.levels || []
          }))
        };
      }
      // Raw words.json format (has levels[])
      if (Array.isArray(data.levels)) {
        return {
          version: 2,
          updatedAt: 0,
          mediaBase: DEFAULT_MEDIA_BASE,
          series: [
            {
              id: 'smart-phonics',
              name: 'Smart Phonics',
              levels: data.levels
            }
          ]
        };
      }
      return null;
    },

    resolveUrl(path, base) {
      if (!path) return '';
      if (path.startsWith('data:') || path.startsWith('blob:')) {
        return path;
      }
      const activeBase = (base || getMediaBase()).replace(/\/$/, '');

      // Auto-migrate legacy Netlify media URLs to current mediaBase
      if (path.startsWith('https://all-english-media.netlify.app/') || path.startsWith('http://all-english-media.netlify.app/')) {
        return path.replace(/^https?:\/\/all-english-media\.netlify\.app\/?/, `${activeBase}/`);
      }

      if (path.startsWith('http://') || path.startsWith('https://')) {
        return path;
      }
      const cleanPath = path.replace(/^(\.\/|data\/|media\/)/, '');
      return `${activeBase}/${cleanPath}`;
    },

    /**
     * Adapts canonical curriculum for Phonics Flash ({ id, name, levels: [...] })
     */
    toPhonicsFlash(data, mediaBase, seriesId) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return { levels: [] };
      const targetSlug = seriesId ? toSeriesSlug(seriesId) : null;
      const sp = targetSlug
        ? (norm.series.find(s => toSeriesSlug(s.id) === targetSlug || toSeriesSlug(s.name) === targetSlug) || norm.series[0])
        : (norm.series.find(s => toSeriesSlug(s.id) === 'smart-phonics') || norm.series[0]);
      const activeBase = mediaBase || (getMediaBase() !== 'https://all-english-media.allenglish.link' ? getMediaBase() : (norm.mediaBase || getMediaBase()));

      return {
        id: sp.id || toSeriesSlug(sp.name),
        name: sp.name || toSeriesDisplayName(sp.id),
        levels: (sp.levels || []).map(lvl => ({
          ...lvl,
          units: (lvl.units || []).map(unit => ({
            ...unit,
            words: (unit.words || []).map(w => ({
              ...w,
              image: this.resolveUrl(w.image, activeBase),
              audio: this.resolveUrl(w.audio, activeBase)
            }))
          }))
        }))
      };
    },

    /**
     * Adapts all series for Phonics Flash ([ { id, name, levels: [...] }, ... ])
     */
    toPhonicsFlashAll(data, mediaBase) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return [];
      return norm.series.map(s => this.toPhonicsFlash(data, mediaBase, s.id));
    },

    /**
     * Adapts canonical curriculum for MatchMaker ({ 1: { "Unit 1: abc": [...] } })
     */
    toMatchMaker(data, mediaBase, seriesId) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return {};
      const targetSlug = seriesId ? toSeriesSlug(seriesId) : null;
      const sp = targetSlug
        ? (norm.series.find(s => toSeriesSlug(s.id) === targetSlug || toSeriesSlug(s.name) === targetSlug) || norm.series[0])
        : (norm.series.find(s => toSeriesSlug(s.id) === 'smart-phonics') || norm.series[0]);
      const activeBase = mediaBase || (getMediaBase() !== 'https://all-english-media.allenglish.link' ? getMediaBase() : (norm.mediaBase || getMediaBase()));
      const bookMap = {};

      for (const lvl of sp.levels || []) {
        const bookNum = lvl.bookNumber || parseInt(String(lvl.id).replace(/\D/g, ''), 10) || 1;
        bookMap[bookNum] = {};

        for (const unit of lvl.units || []) {
          const cardList = [];
          if (unit.targetLetters && unit.targetLetters.length) {
            const tl = Array.isArray(unit.targetLetters) ? unit.targetLetters.join(', ') : unit.targetLetters;
            cardList.push({ targetLetters: tl });
          }

          for (const w of unit.words || []) {
            const card = {
              word: w.word,
              image: this.resolveUrl(w.image, activeBase),
              sound: this.resolveUrl(w.audio, activeBase)
            };
            if (w.imageAudio) {
              card.imageSound = this.resolveUrl(w.imageAudio, activeBase);
            }
            cardList.push(card);
          }
          bookMap[bookNum][unit.name] = cardList;
        }
      }
      return bookMap;
    },

    /**
     * Adapts all series for MatchMaker ({ SmartPhonics: { 1: ... }, JollyPhonics: { 1: ... } })
     */
    toMatchMakerAll(data, mediaBase) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return {};
      const all = {};
      for (const s of norm.series) {
        const key = toPascalCase(s.id || s.name);
        all[key] = this.toMatchMaker(data, mediaBase, s.id);
      }
      return all;
    },

    /**
     * Adapts canonical curriculum for Sunken Treasure & Tic-Tac-Toe ({ level1: { unit1: {...} } })
     */
    toWordBank(data, seriesId) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return {};
      const targetSlug = seriesId ? toSeriesSlug(seriesId) : null;
      const sp = targetSlug
        ? (norm.series.find(s => toSeriesSlug(s.id) === targetSlug || toSeriesSlug(s.name) === targetSlug) || norm.series[0])
        : (norm.series.find(s => toSeriesSlug(s.id) === 'smart-phonics') || norm.series[0]);
      const bank = {};

      for (const lvl of sp.levels || []) {
        const bookNum = lvl.bookNumber || parseInt(String(lvl.id).replace(/\D/g, ''), 10) || 1;
        const levelKey = `level${bookNum}`;
        bank[levelKey] = {};

        for (const unit of lvl.units || []) {
          const unitNum = unit.unitNumber || (String(unit.id).match(/\d+$/)?.[0]) || '1';
          const unitKey = `unit${unitNum}`;

          let title = unit.unitTitle;
          if (!title && unit.name) {
            title = unit.name.replace(/^Unit\s+\d+:\s*/i, '');
          }
          let l1Letters = null;
          if (bookNum === 1) {
            if (Array.isArray(unit.targetLetters) && unit.targetLetters.length) {
              l1Letters = unit.targetLetters.map(l => String(l).toLowerCase());
            } else if (unit.targetSound) {
              const parts = String(unit.targetSound).split(/[,/ ]+/).filter(Boolean);
              if (parts.length && parts.every(p => p.length === 1 && /[a-zA-Z]/.test(p))) {
                l1Letters = parts.map(p => p.toLowerCase());
              }
            } else if (unit.name) {
              const m = String(unit.name).match(/:\s*([a-zA-Z]+)/);
              if (m) l1Letters = m[1].toLowerCase().split('');
            }
            if (!l1Letters && Array.isArray(unit.words) && unit.words.length) {
              const set = new Set();
              unit.words.forEach(w => {
                const txt = typeof w === 'string' ? w : (w.word || '');
                if (txt && /^[a-zA-Z]/.test(txt)) set.add(txt[0].toLowerCase());
              });
              if (set.size > 0 && set.size <= 4) l1Letters = Array.from(set);
            }
          }

          if (l1Letters && l1Letters.length) {
            title = l1Letters.join('').toUpperCase();
          }

          let words = [];
          let extraWords = [];
          let bonusWords = [];

          if (l1Letters && l1Letters.length) {
            for (const l of l1Letters) {
              words.push(l.toUpperCase(), l.toLowerCase());
              extraWords.push(l.toUpperCase() + l.toLowerCase());
            }
          } else {
            words = [...new Set((unit.words || []).map(w => typeof w === 'string' ? w : w.word))];
            extraWords = (unit.extraWords || []).map(w => typeof w === 'string' ? w : (w.word || ''));
            bonusWords = (unit.bonusWords || []).map(w => typeof w === 'string' ? w : (w.word || ''));
          }

          bank[levelKey][unitKey] = {
            targetSound: unit.targetSound || '',
            unitTitle: title || `Unit ${unitNum}`,
            words,
            extraWords,
            bonusWords
          };
        }
      }
      return bank;
    },

    /**
     * Adapts all series for Sunken Treasure & Tic-Tac-Toe.
     * Canonical Path: result.series['smart-phonics'].levels
     * Deprecated Compat Shim: root-level level1, level2, ... alias smart-phonics
     */
    toWordBankAll(data) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return { series: {} };
      const all = {
        series: {}
      };
      for (const s of norm.series) {
        const slug = toSeriesSlug(s.id || s.name);
        all.series[slug] = {
          id: slug,
          name: s.name || toSeriesDisplayName(slug),
          levels: this.toWordBank(data, s.id)
        };
      }
      // Backward-compatibility shim: alias smart-phonics directly on root
      const sp = all.series['smart-phonics'] || Object.values(all.series)[0];
      if (sp && sp.levels) {
        Object.assign(all, sp.levels);
      }
      return all;
    }
  };

  // ── 7. Unified Curriculum Loader ──────────────────────────────
  const CurriculumLoader = {
    cachedCurriculum: null,

    /**
     * 3-Tier Load Chain: Upstash -> CDN -> Local Fallback
     */
    async load({ cdnBase = null, fallbackData = null, forceRefresh = false } = {}) {
      if (this.cachedCurriculum && !forceRefresh) {
        return this.cachedCurriculum;
      }

      // 1. Check Upstash live edits if credentials exist
      try {
        const cloudData = await fetchUpstash(UPSTASH_SHARED_CURRICULUM_KEY);
        if (cloudData) {
          const normalized = CurriculumAdapter.normalize(cloudData);
          if (normalized) {
            this.cachedCurriculum = normalized;
            return normalized;
          }
        }
      } catch (e) {
        console.warn('[CurriculumLoader] Upstash check skipped/failed:', e);
      }

      // 2. Fetch from CDN curriculum.json with cache buster
      try {
        const cleanCdn = (cdnBase || getMediaBase()).replace(/\/$/, '');
        const res = await fetch(`${cleanCdn}/curriculum.json?v=2.0`);
        if (res.ok) {
          const cdnJson = await res.json();
          const normalized = CurriculumAdapter.normalize(cdnJson);
          if (normalized) {
            this.cachedCurriculum = normalized;
            return normalized;
          }
        }
      } catch (e) {
        console.warn('[CurriculumLoader] CDN fetch failed, falling back to local bundle:', e);
      }

      // 3. Bundled offline fallback
      if (fallbackData) {
        const normalized = CurriculumAdapter.normalize(fallbackData);
        if (normalized) {
          this.cachedCurriculum = normalized;
          return normalized;
        }
      }

      return null;
    }
  };

  // Reconcile cookie with localStorage on load
  try {
    reconcileCookieWithLocalStorage();
  } catch (e) {
    console.warn('[SharedClassSync] Initial cookie reconciliation error:', e);
  }

  return {
    SHARED_SETS_KEY,
    SHARED_ACTIVE_PLAYERS_KEY,
    SHARED_CLASS_PROFILES_KEY,
    UPSTASH_URL_KEY,
    UPSTASH_TOKEN_KEY,
    UPSTASH_SHARED_CURRICULUM_KEY,
    DEFAULT_MEDIA_BASE,
    getMediaBase,
    parseScheduleFromName,
    findActiveScheduledClass,
    toSeriesSlug,
    toPascalCase,
    toSeriesDisplayName,
    toCanonicalUnit,
    toPhonicsFlash,
    toTicTacToe,
    toMatchMaker,
    toTreasureHunt,
    getHighestUnit,
    getCredentials,
    saveCredentials,
    clearCredentials,
    getSharedApiKey,
    setSharedApiKey,
    SHARED_COOKIE_NAME,
    getRootDomain,
    readCookie,
    writeCookie,
    deleteCookie,
    readSharedSyncCookie,
    writeSharedSyncCookie,
    reconcileCookieWithLocalStorage,
    fetchUpstash,
    syncUpstash,
    loadAllClasses,
    saveClassUnits,
    SHARED_HIDDEN_BOOKS_KEY,
    getHiddenBooks,
    setHiddenBooks,
    isBookHidden,
    getVisibleSeries,
    SHARED_ACTIVE_CLASS_KEY,
    getActivePlayers,
    getActiveSession,
    saveActivePlayers,
    clearActivePlayers,
    resolveClassRoster,
    CurriculumAdapter,
    CurriculumLoader
  };
});
