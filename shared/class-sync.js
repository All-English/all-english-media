/**
 * class-sync.js (v2.0)
 * Universal schedule parsing, time-matching, unit translation,
 * and canonical curriculum adapter/loader.
 * Shared across Phonics Flash, Word-Tac-Toe, MatchMaker, Treasure Hunt, and Phonics Level Test.
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
  const SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY = 'shared_active_players_updated_at';
  const SHARED_ACTIVE_SESSION_KEY = 'shared_active_session';
  const SHARED_ACTIVE_CLASS_KEY = 'shared_active_class';
  const SHARED_ACTIVE_UNITS_KEY = 'shared_active_units';
  const SHARED_CLASS_PROFILES_KEY = 'shared_class_profiles';
  const SHARED_HIDDEN_BOOKS_KEY = 'shared_hidden_books';
  const SHARED_COOKIE_NAME = 'ae_shared_sync';
  const CONVEX_SYNC_CODE_KEY = 'convex_sync_code';
  const CONVEX_SYNC_PIN_KEY = 'convex_sync_pin';
  const CONVEX_CURRICULUM_OVERRIDES_KEY = 'convex_curriculum_overrides';
  const CONVEX_URL_STORAGE_KEY = 'convex_cloud_url';
  const DEFAULT_CONVEX_URL = 'https://shiny-tapir-482.ap-southeast-2.convex.cloud';
  const UPSTASH_URL_KEY = 'upstash_redis_url';
  const UPSTASH_TOKEN_KEY = 'upstash_redis_token';
  const UPSTASH_SHARED_CURRICULUM_KEY = 'shared_phonics_curriculum';
  const ELEVENLABS_KEY = 'elevenlabs_api_key';
  const PHONICS_FLASH_ELEVENLABS_KEY = 'phonics-flash-elevenlabs-key';

  function getConvexUrl() {
    if (typeof window !== 'undefined' && window.CONVEX_URL) {
      return String(window.CONVEX_URL).trim().replace(/\/$/, '');
    }
    if (typeof localStorage !== 'undefined') {
      const stored = localStorage.getItem(CONVEX_URL_STORAGE_KEY);
      if (stored && stored.trim()) return stored.trim().replace(/\/$/, '');
    }
    return DEFAULT_CONVEX_URL;
  }
  
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

    const pad = n => String(n).padStart(2, '0');

    // 2. Check for explicit time range: e.g. 4:00-5:00, 4:00~4:50, 4-5pm, 4 to 5
    const rangeMatch = className.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*(?:-|~|to)\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    if (rangeMatch) {
      let startHour = parseInt(rangeMatch[1], 10);
      let startMin = rangeMatch[2] ? parseInt(rangeMatch[2], 10) : 0;
      const startAmPm = (rangeMatch[3] || rangeMatch[7] || '').toLowerCase();

      let endHour = parseInt(rangeMatch[4], 10);
      let endMin = rangeMatch[5] ? parseInt(rangeMatch[5], 10) : 0;
      const endAmPm = (rangeMatch[6] || rangeMatch[3] || '').toLowerCase();

      if (startAmPm === 'pm' && startHour < 12) startHour += 12;
      else if (startAmPm === 'am' && startHour === 12) startHour = 0;
      else if (!startAmPm && startHour >= 1 && startHour <= 8) startHour += 12;

      if (endAmPm === 'pm' && endHour < 12) endHour += 12;
      else if (endAmPm === 'am' && endHour === 12) endHour = 0;
      else if (!endAmPm && endHour >= 1 && endHour <= 8) endHour += 12;

      if (endHour * 60 + endMin <= startHour * 60 + startMin) {
        endHour = startHour + 1;
      }

      return {
        days: matchedDays,
        startTime: `${pad(startHour)}:${pad(startMin)}`,
        endTime: `${pad(endHour)}:${pad(endMin)}`
      };
    }

    // 3. Single time match: e.g. 4:00, 4:00pm, 4pm, 4 PM, 4
    const timeMatch = className.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
    let startHour = 15;
    let startMin = 0;

    if (timeMatch && timeMatch[1]) {
      startHour = parseInt(timeMatch[1], 10);
      startMin = timeMatch[2] ? parseInt(timeMatch[2], 10) : 0;
      const ampm = (timeMatch[3] || '').toLowerCase();

      if (ampm === 'pm' && startHour < 12) {
        startHour += 12;
      } else if (ampm === 'am' && startHour === 12) {
        startHour = 0;
      } else if (!ampm && startHour >= 1 && startHour <= 8) {
        startHour += 12;
      }
    }

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

  function isTimestampInCurrentClassSession(timestamp, className, profile, date = new Date()) {
    if (!timestamp || timestamp <= 0) return false;
    const nowMs = date.getTime();
    if (nowMs - timestamp > 90 * 60 * 1000 || timestamp > nowMs + 5 * 60 * 1000) return false;

    const tsDate = new Date(timestamp);
    if (
      tsDate.getFullYear() !== date.getFullYear() ||
      tsDate.getMonth() !== date.getMonth() ||
      tsDate.getDate() !== date.getDate()
    ) {
      return false;
    }

    const schedule = profile?.schedule || parseScheduleFromName(className);
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    const currentDay = dayNames[date.getDay()];
    if (!schedule || !Array.isArray(schedule.days) || !schedule.days.includes(currentDay)) {
      return false;
    }

    const startParts = (schedule.startTime || '00:00').split(':').map(Number);
    const endParts = (schedule.endTime || '23:59').split(':').map(Number);
    const startMin = (startParts[0] || 0) * 60 + (startParts[1] || 0);
    let endMin = (endParts[0] || 0) * 60 + (endParts[1] || 0);
    if (endMin <= startMin) endMin = startMin + 60;

    const tsMinutes = tsDate.getHours() * 60 + tsDate.getMinutes();
    return tsMinutes >= (startMin - 15) && tsMinutes <= endMin;
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

    // 7. EditorStore custom book format: <series>_L<lvl>_U<unit> or <series>_L<lvl>U<unit>
    m = str.match(/^([a-z0-9_-]+)_L(\d+)_?U(\d+)$/i);
    if (m) {
      const series = toSeriesSlug(m[1]);
      const level = parseInt(m[2], 10);
      const unit = parseInt(m[3], 10);
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

  function normalizeSyncCode(raw) {
    return String(raw || '').trim().replace(/\s+/g, ' ').toLowerCase();
  }

  function getSyncConfig() {
    let syncCode = '';
    let pin = '';

    if (typeof localStorage !== 'undefined') {
      syncCode = normalizeSyncCode(localStorage.getItem(CONVEX_SYNC_CODE_KEY) || '');
      pin = (localStorage.getItem(CONVEX_SYNC_PIN_KEY) || '').trim();
    }

    if (!syncCode) {
      const cookie = readSharedSyncCookie();
      if (cookie && cookie.sCode) {
        syncCode = normalizeSyncCode(cookie.sCode);
        pin = (cookie.sPin || '').trim();
        if (typeof localStorage !== 'undefined' && syncCode) {
          try {
            localStorage.setItem(CONVEX_SYNC_CODE_KEY, syncCode);
            if (pin) localStorage.setItem(CONVEX_SYNC_PIN_KEY, pin);
          } catch {}
        }
      }
    }

    return {
      syncCode,
      pin,
      convexUrl: getConvexUrl()
    };
  }

  function saveSyncConfig(syncCode, pin = '') {
    const cleanCode = normalizeSyncCode(syncCode);
    const cleanPin = String(pin || '').trim();

    if (typeof localStorage !== 'undefined') {
      if (cleanCode) {
        localStorage.setItem(CONVEX_SYNC_CODE_KEY, cleanCode);
        if (cleanPin) {
          localStorage.setItem(CONVEX_SYNC_PIN_KEY, cleanPin);
        } else {
          localStorage.removeItem(CONVEX_SYNC_PIN_KEY);
        }
      } else {
        localStorage.removeItem(CONVEX_SYNC_CODE_KEY);
        localStorage.removeItem(CONVEX_SYNC_PIN_KEY);
      }
    }

    if (cleanCode) {
      writeSharedSyncCookie({
        sCode: cleanCode,
        sPin: cleanPin || null,
        uUrl: null,
        uTok: null
      });
      startLiveSubscription();
    } else {
      stopLiveSubscription();
      const cookie = readSharedSyncCookie();
      if (cookie) {
        delete cookie.sCode;
        delete cookie.sPin;
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

    return { syncCode: cleanCode, pin: cleanPin };
  }

  function clearSyncConfig() {
    return saveSyncConfig('', '');
  }

  // Backward-compatible credential aliases
  function saveCredentials(codeOrUrl, pinOrToken) {
    return saveSyncConfig(codeOrUrl, pinOrToken);
  }

  function clearCredentials() {
    return clearSyncConfig();
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

    const localSyncCode = normalizeSyncCode(localStorage.getItem(CONVEX_SYNC_CODE_KEY) || '');
    const localSyncPin = (localStorage.getItem(CONVEX_SYNC_PIN_KEY) || '').trim();
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

    let localActUpdatedAt = 0;
    try {
      localActUpdatedAt = parseInt(localStorage.getItem(SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY) || '0', 10) || 0;
    } catch {}

    const updatesForCookie = {};
    let cookieChanged = false;

    if (cookie) {
      if (cookie.sCode && !localSyncCode) {
        try {
          localStorage.setItem(CONVEX_SYNC_CODE_KEY, normalizeSyncCode(cookie.sCode));
          if (cookie.sPin) {
            localStorage.setItem(CONVEX_SYNC_PIN_KEY, String(cookie.sPin).trim());
          }
        } catch {}
      } else if (localSyncCode && (!cookie.sCode || normalizeSyncCode(cookie.sCode) !== localSyncCode)) {
        updatesForCookie.sCode = localSyncCode;
        if (localSyncPin) updatesForCookie.sPin = localSyncPin;
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

      const cookieActUpdatedAt = cookie.actUpdatedAt || cookie.updatedAt || 0;

      // Reconcile active players based on timestamp
      if (cookieActUpdatedAt > localActUpdatedAt && Array.isArray(cookie.act)) {
        try {
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(cookie.act));
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY, String(cookieActUpdatedAt));
          if (cookie.actClass) {
            localStorage.setItem(SHARED_ACTIVE_CLASS_KEY, cookie.actClass);
          } else {
            localStorage.removeItem(SHARED_ACTIVE_CLASS_KEY);
          }
        } catch {}
      } else if (localActUpdatedAt > cookieActUpdatedAt && localActive.length > 0) {
        updatesForCookie.act = localActive;
        if (localActiveClass) updatesForCookie.actClass = localActiveClass;
        updatesForCookie.actUpdatedAt = localActUpdatedAt;
        cookieChanged = true;
      } else if (Array.isArray(cookie.act) && cookie.act.length > 0 && localActive.length === 0) {
        try {
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(cookie.act));
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY, String(cookieActUpdatedAt || Date.now()));
          if (cookie.actClass) {
            localStorage.setItem(SHARED_ACTIVE_CLASS_KEY, cookie.actClass);
          }
        } catch {}
      } else if (localActive.length > 0 && (!cookie.act || cookie.act.length === 0)) {
        updatesForCookie.act = localActive;
        if (localActiveClass) updatesForCookie.actClass = localActiveClass;
        updatesForCookie.actUpdatedAt = localActUpdatedAt || Date.now();
        cookieChanged = true;
      }
    } else {
      if (localSyncCode) {
        updatesForCookie.sCode = localSyncCode;
        if (localSyncPin) updatesForCookie.sPin = localSyncPin;
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
        updatesForCookie.actUpdatedAt = localActUpdatedAt || Date.now();
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
    const { syncCode, pin, convexUrl } = getSyncConfig();
    return {
      syncCode,
      pin,
      convexUrl,
      // Legacy properties mapped so truthiness checks (creds.url && creds.token) still work if any caller checks them
      url: syncCode ? convexUrl : '',
      token: syncCode || ''
    };
  }

  // ── 4b. Convex HTTP API & Live WebSocket Subscription ──────────
  function getClientOrigin() {
    if (typeof window !== 'undefined' && window.location) {
      return window.location.origin || `${window.location.protocol}//${window.location.host}`;
    }
    return '';
  }

  function isAllowedClientDomain() {
    if (typeof window === 'undefined' || !window.location) return true;
    const protocol = (window.location.protocol || '').toLowerCase();
    if (protocol === 'file:') return true;
    const hostname = (window.location.hostname || '').toLowerCase();
    if (!hostname) return true;
    if (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '::1' ||
      hostname.endsWith('.local')
    ) {
      return true;
    }
    if (hostname === 'allenglish.link' || hostname.endsWith('.allenglish.link')) {
      return true;
    }
    if (hostname.endsWith('.netlify.app')) {
      return (
        hostname.includes('all-english') ||
        hostname.includes('allenglish') ||
        hostname.includes('phonics') ||
        hostname.includes('matchmaker') ||
        hostname.includes('sunken-treasure') ||
        hostname.includes('word-tac-toe') ||
        hostname.includes('tic-tac-toe')
      );
    }
    if (hostname === 'all-english.github.io') {
      return true;
    }
    return false;
  }

  function getConvexSiteUrl() {
    const cloudUrl = getConvexUrl();
    if (!cloudUrl) return '';
    return cloudUrl.replace(/\.convex\.cloud$/, '.convex.site');
  }

  async function convexHttpSync(kind, fnPath, args = {}) {
    if (!isAllowedClientDomain()) {
      console.warn('[SharedClassSync] Cloud Sync blocked on unauthorized domain.');
      return null;
    }
    const baseUrl = getConvexUrl();
    if (!baseUrl) return null;
    const siteUrl = getConvexSiteUrl();
    const origin = getClientOrigin();
    const argsWithOrigin = origin ? { ...args, origin } : { ...args };

    if (siteUrl) {
      try {
        const res = await fetch(`${siteUrl}/api/sync`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: fnPath, args: argsWithOrigin })
        });
        if (res.status === 403) {
          return null;
        }
        if (res.ok) {
          const data = await res.json();
          if (data && data.status === 'success') {
            return data.value;
          }
        }
      } catch {}
    }

    try {
      const res = await fetch(`${baseUrl}/api/${kind}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: fnPath, args: argsWithOrigin, format: 'json' })
      });
      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.status === 'success') {
        return data.value;
      }
      return null;
    } catch (err) {
      console.warn(`[SharedClassSync] Convex ${kind} "${fnPath}" error:`, err);
      return null;
    }
  }

  async function convexQuery(fnPath, args = {}) {
    return convexHttpSync('query', fnPath, args);
  }

  async function convexMutation(fnPath, args = {}) {
    return convexHttpSync('mutation', fnPath, args);
  }

  let liveConvexClient = null;
  let liveUnsubscribe = null;
  let liveSubscribedKey = '';
  let lastSnapshotHash = '';

  function stopLiveSubscription() {
    if (typeof liveUnsubscribe === 'function') {
      try { liveUnsubscribe(); } catch {}
    }
    liveUnsubscribe = null;
    liveSubscribedKey = '';
    if (liveConvexClient && typeof liveConvexClient.close === 'function') {
      try { liveConvexClient.close(); } catch {}
    }
    liveConvexClient = null;
  }

  async function startLiveSubscription() {
    if (typeof window === 'undefined') return;
    if (!isAllowedClientDomain()) {
      stopLiveSubscription();
      return;
    }
    const { syncCode, pin, convexUrl } = getSyncConfig();
    if (!syncCode || !convexUrl) {
      stopLiveSubscription();
      return;
    }
    const targetKey = `${convexUrl}|${syncCode}|${pin}`;
    if (liveSubscribedKey === targetKey && liveUnsubscribe) {
      return;
    }
    stopLiveSubscription();
    liveSubscribedKey = targetKey;

    try {
      const mod = await import('https://esm.sh/convex@1.21.0/browser');
      if (!mod || !mod.ConvexClient) return;
      if (liveSubscribedKey !== targetKey) return;

      liveConvexClient = new mod.ConvexClient(convexUrl);
      const origin = getClientOrigin();
      const queryArgs = { syncCode };
      if (pin) queryArgs.pin = pin;
      if (origin) queryArgs.origin = origin;

      liveUnsubscribe = liveConvexClient.onUpdate(
        'sync:getWorkspaceSnapshot',
        queryArgs,
        (result) => {
          if (result && result.ok && result.snapshot) {
            const hash = JSON.stringify(result.snapshot);
            if (hash !== lastSnapshotHash) {
              lastSnapshotHash = hash;
              applySnapshotToLocal(result.snapshot, { fromLiveUpdate: true });
            }
          }
        }
      );
    } catch (err) {
      // Graceful fallback to HTTP queries if ESM CDN is unreachable
      console.debug('[SharedClassSync] Live WebSocket subscription unavailable, using HTTP sync.');
    }
  }

  function applySnapshotToLocal(snapshot, { fromLiveUpdate = false } = {}) {
    if (!snapshot || typeof localStorage === 'undefined') return;

    const playerSets = {};
    const classProfiles = {};
    let existingProfiles = {};
    try {
      existingProfiles = JSON.parse(localStorage.getItem(SHARED_CLASS_PROFILES_KEY) || '{}') || {};
    } catch {}

    const pfClassesList = [];
    let existingPfStore = { classes: [], activeClassId: null, updatedAt: Date.now() };
    try {
      const rawPf = localStorage.getItem('phonics-flash-classes');
      if (rawPf) existingPfStore = JSON.parse(rawPf) || existingPfStore;
    } catch {}
    const existingPfByName = new Map(
      (Array.isArray(existingPfStore.classes) ? existingPfStore.classes : []).map(c => [c.name, c])
    );

    if (Array.isArray(snapshot.classes)) {
      for (const cls of snapshot.classes) {
        if (!cls || !cls.name) continue;
        const cName = cls.name.trim();
        if (!cName) continue;

        if (Array.isArray(cls.players) && cls.players.length > 0) {
          playerSets[cName] = cls.players;
        } else if (!playerSets[cName]) {
          playerSets[cName] = [];
        }

        const localProf = existingProfiles[cName];
        const useLocalProf = localProf && (localProf.updatedAt || 0) > (cls.updatedAt || 0);

        classProfiles[cName] = useLocalProf
          ? localProf
          : {
              schedule: cls.schedule || parseScheduleFromName(cName),
              curriculumId: cls.curriculumId || 'smart-phonics',
              units: Array.isArray(cls.units) ? cls.units : [],
              updatedAt: cls.updatedAt || Date.now()
            };

        const prevPf = existingPfByName.get(cName);
        pfClassesList.push({
          id: cls.pfClassId || prevPf?.id || `cls_${cName.replace(/\W+/g, '_').toLowerCase()}`,
          name: cName,
          schedule: classProfiles[cName].schedule,
          curriculumId: classProfiles[cName].curriculumId || 'smart-phonics',
          selectedUnits: classProfiles[cName].units || [],
          updatedAt: classProfiles[cName].updatedAt || Date.now()
        });
      }
    }

    try {
      localStorage.setItem(SHARED_SETS_KEY, JSON.stringify(playerSets));
      localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(classProfiles));
      if (pfClassesList.length > 0) {
        const matchedActivePf = pfClassesList.find(c => c.name === snapshot.activeClassName);
        localStorage.setItem('phonics-flash-classes', JSON.stringify({
          classes: pfClassesList,
          activeClassId: matchedActivePf ? matchedActivePf.id : (existingPfStore.activeClassId || pfClassesList[0].id),
          updatedAt: snapshot.updatedAt || Date.now()
        }));
      }
    } catch {}

    // Active units
    if (Array.isArray(snapshot.activeUnits) && snapshot.activeUnits.length > 0) {
      const localUnits = getActiveUnits();
      if ((snapshot.activeUnitsUpdatedAt || 0) >= (localUnits.updatedAt || 0)) {
        const unitsPayload = {
          units: snapshot.activeUnits,
          curriculumId: snapshot.activeCurriculumId || 'smart-phonics',
          className: snapshot.activeUnitsClassName || snapshot.activeClassName || '',
          updatedAt: snapshot.activeUnitsUpdatedAt || snapshot.updatedAt || Date.now()
        };
        try {
          localStorage.setItem(SHARED_ACTIVE_UNITS_KEY, JSON.stringify(unitsPayload));
        } catch {}
        writeSharedSyncCookie({
          actUnits: unitsPayload.units,
          actCur: unitsPayload.curriculumId,
          actUnitsAt: unitsPayload.updatedAt
        });
      }
    }

    // Hidden books
    if (Array.isArray(snapshot.hiddenBooks)) {
      try {
        localStorage.setItem(SHARED_HIDDEN_BOOKS_KEY, JSON.stringify(snapshot.hiddenBooks));
      } catch {}
      writeSharedSyncCookie({ hidden: snapshot.hiddenBooks });
    }
    if (typeof snapshot.hideBuiltIn === 'boolean') {
      try {
        localStorage.setItem('phonics-flash-hide-builtin', snapshot.hideBuiltIn ? 'true' : 'false');
      } catch {}
    }

    // Active players / session
    if (Array.isArray(snapshot.activePlayers) && snapshot.activePlayers.length > 0) {
      const localSession = getActiveSession();
      if ((snapshot.activePlayersUpdatedAt || 0) >= (localSession.updatedAt || 0)) {
        try {
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(snapshot.activePlayers));
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY, String(snapshot.activePlayersUpdatedAt || Date.now()));
          if (snapshot.activeClassName) {
            localStorage.setItem(SHARED_ACTIVE_CLASS_KEY, snapshot.activeClassName);
          }
        } catch {}
        writeSharedSyncCookie({
          act: snapshot.activePlayers,
          actClass: snapshot.activeClassName || undefined,
          actUpdatedAt: snapshot.activePlayersUpdatedAt || Date.now()
        });
      }
    }

    // Curriculum overrides
    if (Array.isArray(snapshot.curriculumOverrides)) {
      try {
        localStorage.setItem(CONVEX_CURRICULUM_OVERRIDES_KEY, JSON.stringify(snapshot.curriculumOverrides));
        CurriculumLoader.cachedCurriculum = null;
      } catch {}
    }

    if (fromLiveUpdate && typeof window !== 'undefined' && typeof window.dispatchEvent === 'function') {
      try {
        window.dispatchEvent(new CustomEvent('ae-cloud-sync-updated', {
          detail: { snapshot, playerSets, classProfiles }
        }));
      } catch {}
    }
  }

  function collectLocalStateForUpload() {
    let playerSets = {};
    let classProfiles = {};
    let pfStore = null;
    let hiddenBooks = getHiddenBooks();
    let hideBuiltIn = false;
    let curriculumOverrides = [];

    if (typeof localStorage !== 'undefined') {
      try {
        playerSets = JSON.parse(localStorage.getItem(SHARED_SETS_KEY) || '{}') || {};
      } catch {}
      try {
        classProfiles = JSON.parse(localStorage.getItem(SHARED_CLASS_PROFILES_KEY) || '{}') || {};
      } catch {}
      try {
        pfStore = JSON.parse(localStorage.getItem('phonics-flash-classes') || 'null');
      } catch {}
      try {
        hideBuiltIn = localStorage.getItem('phonics-flash-hide-builtin') === 'true';
      } catch {}
      try {
        curriculumOverrides = JSON.parse(localStorage.getItem(CONVEX_CURRICULUM_OVERRIDES_KEY) || '[]') || [];
      } catch {}
    }

    const classMap = new Map();
    for (const [name, players] of Object.entries(playerSets)) {
      const cleanName = name.trim();
      if (!cleanName) continue;
      classMap.set(cleanName, {
        name: cleanName,
        players: Array.isArray(players) ? players.map(String) : [],
        curriculumId: 'smart-phonics',
        units: [],
        schedule: parseScheduleFromName(cleanName),
        updatedAt: Date.now()
      });
    }

    for (const [name, prof] of Object.entries(classProfiles)) {
      const cleanName = name.trim();
      if (!cleanName || !prof || typeof prof !== 'object') continue;
      const existing = classMap.get(cleanName) || {
        name: cleanName,
        players: Array.isArray(playerSets[cleanName]) ? playerSets[cleanName].map(String) : [],
        curriculumId: 'smart-phonics',
        units: [],
        schedule: parseScheduleFromName(cleanName),
        updatedAt: Date.now()
      };
      if (Array.isArray(prof.units)) existing.units = prof.units.map(String);
      if (prof.curriculumId) existing.curriculumId = String(prof.curriculumId);
      if (prof.schedule && Array.isArray(prof.schedule.days)) {
        existing.schedule = {
          days: prof.schedule.days.map(String),
          startTime: String(prof.schedule.startTime || '15:00'),
          endTime: String(prof.schedule.endTime || '16:00')
        };
      }
      if (typeof prof.updatedAt === 'number' && prof.updatedAt > 0) {
        existing.updatedAt = prof.updatedAt;
      }
      classMap.set(cleanName, existing);
    }

    if (pfStore && Array.isArray(pfStore.classes)) {
      for (const pfCls of pfStore.classes) {
        if (!pfCls || !pfCls.name) continue;
        const cleanName = pfCls.name.trim();
        const pfUnits = Array.isArray(pfCls.selectedUnits)
          ? pfCls.selectedUnits.map(u => toCanonicalUnit(u)?.id || u).filter(Boolean)
          : [];
        const existing = classMap.get(cleanName) || {
          name: cleanName,
          players: [],
          curriculumId: pfCls.curriculumId || 'smart-phonics',
          units: pfUnits,
          schedule: pfCls.schedule || parseScheduleFromName(cleanName),
          updatedAt: pfCls.updatedAt || Date.now()
        };
        if (pfCls.id) existing.pfClassId = String(pfCls.id);
        if (existing.units.length === 0 && pfUnits.length > 0) {
          existing.units = pfUnits;
        }
        if (pfCls.curriculumId) existing.curriculumId = String(pfCls.curriculumId);
        if (pfCls.schedule && Array.isArray(pfCls.schedule.days)) {
          existing.schedule = {
            days: pfCls.schedule.days.map(String),
            startTime: String(pfCls.schedule.startTime || '15:00'),
            endTime: String(pfCls.schedule.endTime || '16:00')
          };
        }
        classMap.set(cleanName, existing);
      }
    }

    const activeSession = getActiveSession();
    const activeUnitsObj = getActiveUnits();

    return {
      activeClassName: activeSession.className || '',
      activePlayers: activeSession.players || [],
      activePlayersUpdatedAt: activeSession.updatedAt || 0,
      activeCurriculumId: activeUnitsObj.curriculumId || 'smart-phonics',
      activeUnits: activeUnitsObj.units || [],
      activeUnitsClassName: activeUnitsObj.className || '',
      activeUnitsUpdatedAt: activeUnitsObj.updatedAt || 0,
      hiddenBooks,
      hideBuiltIn,
      classes: Array.from(classMap.values()),
      curriculumOverrides
    };
  }

  let pushTimer = null;
  let pendingDeletedClassNames = new Set();

  function schedulePushToConvex({ replaceAllClasses = false, deleteClassName = null } = {}) {
    if (deleteClassName) {
      pendingDeletedClassNames.add(deleteClassName);
    }
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(() => {
      pushLocalStateToConvex({ replaceAllClasses });
    }, 250);
  }

  async function pushLocalStateToConvex({ replaceAllClasses = false } = {}) {
    const { syncCode, pin } = getSyncConfig();
    if (!syncCode) return false;

    const state = collectLocalStateForUpload();
    const deleteNames = Array.from(pendingDeletedClassNames);
    pendingDeletedClassNames.clear();

    const args = {
      syncCode,
      activeClassName: state.activeClassName,
      activePlayers: state.activePlayers,
      activePlayersUpdatedAt: state.activePlayersUpdatedAt,
      activeCurriculumId: state.activeCurriculumId,
      activeUnits: state.activeUnits,
      activeUnitsClassName: state.activeUnitsClassName,
      activeUnitsUpdatedAt: state.activeUnitsUpdatedAt,
      hiddenBooks: state.hiddenBooks,
      hideBuiltIn: state.hideBuiltIn,
      upsertClasses: state.classes,
      replaceAllClasses
    };
    if (pin) args.pin = pin;
    if (deleteNames.length > 0) args.deleteClassNames = deleteNames;

    const res = await convexMutation('sync:saveWorkspaceState', args);
    return Boolean(res && res.ok);
  }

  async function createSyncWorkspace(syncCode, pin = '') {
    const cleanCode = normalizeSyncCode(syncCode);
    const cleanPin = String(pin || '').trim();
    if (!cleanCode) {
      return { ok: false, errorCode: 'INVALID_CODE', message: 'Please enter a Sync Code.' };
    }
    if (cleanPin && !/^\d{4}$/.test(cleanPin)) {
      return { ok: false, errorCode: 'INVALID_PIN', message: 'PIN must be 4 digits (or left blank).' };
    }

    const initialState = collectLocalStateForUpload();
    const args = {
      syncCode: cleanCode,
      initialState
    };
    if (cleanPin) args.pin = cleanPin;

    const res = await convexMutation('sync:createWorkspace', args);
    if (!res) {
      return { ok: false, errorCode: 'NETWORK_ERROR', message: 'Could not reach Cloud Sync server.' };
    }
    if (res.ok && res.snapshot) {
      saveSyncConfig(res.snapshot.syncCode, cleanPin);
      applySnapshotToLocal(res.snapshot);
    }
    return res;
  }

  async function pullLegacyUpstashFromBrowserOnce() {
    if (typeof localStorage === 'undefined') return false;
    let url = (localStorage.getItem(UPSTASH_URL_KEY) || '').trim();
    let token = (localStorage.getItem(UPSTASH_TOKEN_KEY) || '').trim();
    if (!url || !token) {
      try {
        const pfLocal = JSON.parse(localStorage.getItem('phonics-flash-upstash-config') || '{}');
        if (pfLocal && pfLocal.url && pfLocal.token) {
          url = pfLocal.url.trim();
          token = pfLocal.token.trim();
        }
      } catch {}
    }
    if (!url || !token) return false;
    const cleanUrl = url.replace(/\/$/, '');

    const getKey = async (k) => {
      try {
        const r = await fetch(`${cleanUrl}/get/${encodeURIComponent(k)}`, {
          headers: { Authorization: `Bearer ${token}` }
        });
        if (!r.ok) return null;
        const d = await r.json();
        if (!d || d.result == null) return null;
        if (typeof d.result === 'string') {
          try {
            const p = JSON.parse(d.result);
            return typeof p === 'string' ? JSON.parse(p) : p;
          } catch {
            return d.result;
          }
        }
        return d.result;
      } catch {
        return null;
      }
    };

    try {
      const [uSets, uProfiles, uPfClasses, uActiveSession, uActivePlayers, uActiveUnits, uHidden, uCur] = await Promise.all([
        getKey(SHARED_SETS_KEY),
        getKey(SHARED_CLASS_PROFILES_KEY),
        getKey('phonics_flash:classes'),
        getKey(SHARED_ACTIVE_SESSION_KEY),
        getKey(SHARED_ACTIVE_PLAYERS_KEY),
        getKey(SHARED_ACTIVE_UNITS_KEY),
        getKey(SHARED_HIDDEN_BOOKS_KEY),
        getKey(UPSTASH_SHARED_CURRICULUM_KEY)
      ]);

      if (uSets && typeof uSets === 'object' && Object.keys(uSets).length > 0) {
        const localSets = JSON.parse(localStorage.getItem(SHARED_SETS_KEY) || '{}') || {};
        localStorage.setItem(SHARED_SETS_KEY, JSON.stringify({ ...uSets, ...localSets }));
      }
      if (uProfiles && typeof uProfiles === 'object' && Object.keys(uProfiles).length > 0) {
        const localProf = JSON.parse(localStorage.getItem(SHARED_CLASS_PROFILES_KEY) || '{}') || {};
        localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify({ ...uProfiles, ...localProf }));
      }
      if (uPfClasses && typeof uPfClasses === 'object' && Array.isArray(uPfClasses.classes)) {
        const existingPf = localStorage.getItem('phonics-flash-classes');
        if (!existingPf) {
          localStorage.setItem('phonics-flash-classes', JSON.stringify(uPfClasses));
        }
      }
      if (uActiveUnits && Array.isArray(uActiveUnits.units) && uActiveUnits.units.length > 0) {
        const curU = getActiveUnits();
        if (!curU.units || curU.units.length === 0) {
          localStorage.setItem(SHARED_ACTIVE_UNITS_KEY, JSON.stringify(uActiveUnits));
        }
      }
      if (Array.isArray(uHidden) && uHidden.length > 0) {
        const curH = getHiddenBooks();
        if (curH.length === 0) {
          localStorage.setItem(SHARED_HIDDEN_BOOKS_KEY, JSON.stringify(uHidden));
        }
      }
      const sessPlayers = Array.isArray(uActiveSession?.players) ? uActiveSession.players : (Array.isArray(uActivePlayers) ? uActivePlayers : []);
      if (sessPlayers.length > 0 && getActivePlayers().length === 0) {
        localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(sessPlayers));
        if (uActiveSession?.className) {
          localStorage.setItem(SHARED_ACTIVE_CLASS_KEY, uActiveSession.className);
        }
      }
      if (uCur && typeof uCur === 'object') {
        const seriesList = Array.isArray(uCur.series) ? uCur.series : (Array.isArray(uCur.curricula) ? uCur.curricula : []);
        if (seriesList.length > 0) {
          const masterBase = CurriculumLoader.cachedMasterCurriculum || null;
          const computed = computeCurriculumOverrides(seriesList, masterBase);
          if (computed.length > 0) {
            localStorage.setItem(CONVEX_CURRICULUM_OVERRIDES_KEY, JSON.stringify(computed));
          }
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  async function connectSyncWorkspace(syncCode, pin = '') {
    const cleanCode = normalizeSyncCode(syncCode);
    const cleanPin = String(pin || '').trim();
    if (!cleanCode) {
      return { ok: false, errorCode: 'INVALID_CODE', message: 'Please enter your Sync Code.' };
    }

    await pullLegacyUpstashFromBrowserOnce();
    const localBeforeConnect = collectLocalStateForUpload();

    const args = { syncCode: cleanCode };
    if (cleanPin) args.pin = cleanPin;

    const res = await convexQuery('sync:getWorkspaceSnapshot', args);
    if (!res) {
      return { ok: false, errorCode: 'NETWORK_ERROR', message: 'Could not reach Cloud Sync server.' };
    }
    if (res.ok && res.snapshot) {
      saveSyncConfig(res.snapshot.syncCode, cleanPin);

      // If this cloud workspace is newly created/empty and this browser already has local classes or custom edits, push them up!
      const cloudEmpty = (!res.snapshot.classes || res.snapshot.classes.length === 0) &&
                         (!res.snapshot.curriculumOverrides || res.snapshot.curriculumOverrides.length === 0);
      const localHasData = (localBeforeConnect.classes && localBeforeConnect.classes.length > 0) ||
                           (localBeforeConnect.curriculumOverrides && localBeforeConnect.curriculumOverrides.length > 0) ||
                           (localBeforeConnect.activePlayers && localBeforeConnect.activePlayers.length > 0);

      if (cloudEmpty && localHasData) {
        await pushLocalStateToConvex();
        if (localBeforeConnect.curriculumOverrides && localBeforeConnect.curriculumOverrides.length > 0) {
          await saveCurriculumOverridesToConvex({
            overrides: localBeforeConnect.curriculumOverrides,
            hideBuiltIn: localBeforeConnect.hideBuiltIn,
            activeCurriculumId: localBeforeConnect.activeCurriculumId,
            replaceAll: false
          });
        }
        const refreshed = await convexQuery('sync:getWorkspaceSnapshot', args);
        if (refreshed && refreshed.ok && refreshed.snapshot) {
          applySnapshotToLocal(refreshed.snapshot);
          return refreshed;
        }
      }

      applySnapshotToLocal(res.snapshot);
    }
    return res;
  }

  async function syncNow() {
    const { syncCode, pin } = getSyncConfig();
    if (!syncCode) {
      return { ok: false, message: 'No Sync Code configured.' };
    }
    const res = await connectSyncWorkspace(syncCode, pin);
    if (res && res.ok) {
      await pushLocalStateToConvex();
    }
    return res;
  }

  // Legacy shims so existing fetchUpstash / syncUpstash call sites work transparently via Convex
  let cachedSnapshotPromise = null;
  let cachedSnapshotAt = 0;

  async function fetchSnapshotCached() {
    const { syncCode, pin } = getSyncConfig();
    if (!syncCode) return null;
    const now = Date.now();
    if (cachedSnapshotPromise && (now - cachedSnapshotAt) < 1500) {
      return cachedSnapshotPromise;
    }
    cachedSnapshotAt = now;
    cachedSnapshotPromise = convexQuery('sync:getWorkspaceSnapshot', pin ? { syncCode, pin } : { syncCode })
      .then(res => {
        if (res && res.ok && res.snapshot) {
          applySnapshotToLocal(res.snapshot);
          return res.snapshot;
        }
        return null;
      })
      .catch(() => null);
    return cachedSnapshotPromise;
  }

  async function fetchUpstash(key) {
    const snapshot = await fetchSnapshotCached();
    if (!snapshot) return null;

    if (key === SHARED_SETS_KEY) {
      const sets = {};
      for (const c of snapshot.classes || []) {
        sets[c.name] = c.players || [];
      }
      return sets;
    }
    if (key === SHARED_CLASS_PROFILES_KEY) {
      const profiles = {};
      for (const c of snapshot.classes || []) {
        profiles[c.name] = {
          schedule: c.schedule || parseScheduleFromName(c.name),
          curriculumId: c.curriculumId || 'smart-phonics',
          units: c.units || [],
          updatedAt: c.updatedAt || snapshot.updatedAt || Date.now()
        };
      }
      return profiles;
    }
    if (key === 'phonics_flash:classes') {
      return {
        classes: (snapshot.classes || []).map(c => ({
          id: c.pfClassId || `cls_${c.name.replace(/\W+/g, '_').toLowerCase()}`,
          name: c.name,
          schedule: c.schedule || parseScheduleFromName(c.name),
          curriculumId: c.curriculumId || 'smart-phonics',
          selectedUnits: c.units || [],
          updatedAt: c.updatedAt || snapshot.updatedAt || Date.now()
        })),
        updatedAt: snapshot.updatedAt || Date.now()
      };
    }
    if (key === SHARED_ACTIVE_SESSION_KEY) {
      return {
        players: snapshot.activePlayers || [],
        className: snapshot.activeClassName || '',
        updatedAt: snapshot.activePlayersUpdatedAt || 0
      };
    }
    if (key === SHARED_ACTIVE_PLAYERS_KEY) {
      return snapshot.activePlayers || [];
    }
    if (key === SHARED_ACTIVE_CLASS_KEY) {
      return snapshot.activeClassName || '';
    }
    if (key === SHARED_ACTIVE_UNITS_KEY) {
      return {
        units: snapshot.activeUnits || [],
        curriculumId: snapshot.activeCurriculumId || 'smart-phonics',
        className: snapshot.activeUnitsClassName || snapshot.activeClassName || '',
        updatedAt: snapshot.activeUnitsUpdatedAt || 0
      };
    }
    if (key === SHARED_HIDDEN_BOOKS_KEY) {
      return snapshot.hiddenBooks || [];
    }
    if (key === UPSTASH_SHARED_CURRICULUM_KEY || key === 'phonics_flash:curriculum') {
      return snapshot.curriculumOverrides || null;
    }
    return null;
  }

  async function syncUpstash(key, value) {
    const { syncCode } = getSyncConfig();
    if (!syncCode) return false;

    if (typeof localStorage !== 'undefined' && value !== undefined) {
      try {
        if (key === SHARED_SETS_KEY && typeof value === 'object') {
          localStorage.setItem(SHARED_SETS_KEY, JSON.stringify(value));
        } else if (key === SHARED_CLASS_PROFILES_KEY && typeof value === 'object') {
          localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(value));
        } else if (key === 'phonics_flash:classes' && typeof value === 'object') {
          localStorage.setItem('phonics-flash-classes', JSON.stringify(value));
        }
      } catch {}
    }

    const replaceAll = (key === SHARED_SETS_KEY || key === SHARED_CLASS_PROFILES_KEY || key === 'phonics_flash:classes');
    schedulePushToConvex({ replaceAllClasses: replaceAll });
    return true;
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

    const [cloudSets, cloudProfiles, cloudPfClasses, cloudActiveSession, cloudActivePlayers] = await Promise.all([
      fetchUpstash(SHARED_SETS_KEY),
      fetchUpstash(SHARED_CLASS_PROFILES_KEY),
      fetchUpstash('phonics_flash:classes'),
      fetchUpstash(SHARED_ACTIVE_SESSION_KEY),
      fetchUpstash(SHARED_ACTIVE_PLAYERS_KEY)
    ]);

    if (cloudSets && typeof cloudSets === 'object') {
      playerSets = cloudSets;
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(SHARED_SETS_KEY, JSON.stringify(cloudSets));
      }
    }

    let profilesChanged = false;
    if (cloudProfiles && typeof cloudProfiles === 'object') {
      const mergedProfiles = { ...cloudProfiles };
      for (const [k, localProf] of Object.entries(classProfiles)) {
        const cloudProf = mergedProfiles[k];
        if (!cloudProf) {
          mergedProfiles[k] = localProf;
          profilesChanged = true;
        } else if ((localProf.updatedAt || 0) > (cloudProf.updatedAt || 0)) {
          mergedProfiles[k] = localProf;
          profilesChanged = true;
        }
      }
      classProfiles = mergedProfiles;
    }

    // Also reconcile any classes saved in Phonics Flash's `phonics_flash:classes` (cloud or local)
    const pfSources = [];
    if (cloudPfClasses && typeof cloudPfClasses === 'object' && Array.isArray(cloudPfClasses.classes)) {
      pfSources.push(cloudPfClasses);
    }
    if (typeof localStorage !== 'undefined') {
      try {
        const localPfRaw = localStorage.getItem('phonics-flash-classes');
        if (localPfRaw) {
          const localPf = JSON.parse(localPfRaw);
          if (localPf && Array.isArray(localPf.classes)) {
            pfSources.push(localPf);
          }
        }
      } catch {}
    }

    for (const pfStore of pfSources) {
      for (const pfCls of pfStore.classes) {
        if (!pfCls || !pfCls.name) continue;
        const pfUnits = Array.isArray(pfCls.selectedUnits)
          ? pfCls.selectedUnits.map(u => toCanonicalUnit(u)?.id).filter(Boolean)
          : [];
        const existingProf = classProfiles[pfCls.name];
        const pfTime = pfCls.updatedAt || ((!existingProf || !Array.isArray(existingProf.units) || existingProf.units.length === 0) ? (pfStore.updatedAt || 0) : 0);

        if (!existingProf) {
          classProfiles[pfCls.name] = {
            schedule: pfCls.schedule || parseScheduleFromName(pfCls.name),
            curriculumId: pfCls.curriculumId || 'smart-phonics',
            units: pfUnits,
            updatedAt: pfTime
          };
          profilesChanged = true;
        } else if (pfTime > (existingProf.updatedAt || 0) && pfUnits.length > 0) {
          existingProf.units = pfUnits;
          if (pfCls.curriculumId) existingProf.curriculumId = pfCls.curriculumId;
          if (pfCls.schedule) existingProf.schedule = pfCls.schedule;
          existingProf.updatedAt = pfTime;
          profilesChanged = true;
        } else if ((!Array.isArray(existingProf.units) || existingProf.units.length === 0) && pfUnits.length > 0) {
          existingProf.units = pfUnits;
          if (pfCls.curriculumId) existingProf.curriculumId = pfCls.curriculumId;
          if (pfCls.schedule) existingProf.schedule = pfCls.schedule;
          if (pfTime > (existingProf.updatedAt || 0)) existingProf.updatedAt = pfTime;
          profilesChanged = true;
        }

        // If this was the active class in Phonics Flash and has recent units, ensure shared_active_units knows about it
        if (pfStore.activeClassId && pfCls.id === pfStore.activeClassId && pfUnits.length > 0) {
          const currentActive = getActiveUnits();
          if (pfTime > (currentActive.updatedAt || 0)) {
            const payload = {
              units: pfUnits,
              curriculumId: pfCls.curriculumId || 'smart-phonics',
              className: pfCls.name,
              updatedAt: pfTime
            };
            if (typeof localStorage !== 'undefined') {
              try {
                localStorage.setItem(SHARED_ACTIVE_UNITS_KEY, JSON.stringify(payload));
              } catch {}
            }
            writeSharedSyncCookie({
              actUnits: pfUnits,
              actCur: payload.curriculumId,
              actUnitsAt: pfTime
            });
          }
        }
      }
    }

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(classProfiles));
    }

    try {
      const cloudActiveUnits = await fetchUpstash(SHARED_ACTIVE_UNITS_KEY);
      const localActiveUnits = getActiveUnits();
      if (cloudActiveUnits && typeof cloudActiveUnits === 'object' && Array.isArray(cloudActiveUnits.units) && cloudActiveUnits.units.length > 0) {
        if ((cloudActiveUnits.updatedAt || 0) >= (localActiveUnits.updatedAt || 0)) {
          if (typeof localStorage !== 'undefined') {
            localStorage.setItem(SHARED_ACTIVE_UNITS_KEY, JSON.stringify(cloudActiveUnits));
          }
          writeSharedSyncCookie({
            actUnits: cloudActiveUnits.units,
            actCur: cloudActiveUnits.curriculumId || 'smart-phonics',
            actUnitsAt: cloudActiveUnits.updatedAt || Date.now()
          });
        } else if (localActiveUnits.units.length > 0) {
          syncUpstash(SHARED_ACTIVE_UNITS_KEY, localActiveUnits);
        }
      } else if (localActiveUnits && Array.isArray(localActiveUnits.units) && localActiveUnits.units.length > 0) {
        syncUpstash(SHARED_ACTIVE_UNITS_KEY, localActiveUnits);
      }
    } catch (e) {
      console.warn('[SharedClassSync] Error syncing active units:', e);
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

    try {
      const localSession = getActiveSession();
      let resolvedCloudSession = null;
      if (cloudActiveSession && typeof cloudActiveSession === 'object' && Array.isArray(cloudActiveSession.players)) {
        resolvedCloudSession = cloudActiveSession;
      } else if (Array.isArray(cloudActivePlayers) && cloudActivePlayers.length > 0) {
        resolvedCloudSession = {
          players: cloudActivePlayers,
          className: '',
          updatedAt: 0
        };
      }

      if (resolvedCloudSession && Array.isArray(resolvedCloudSession.players) && resolvedCloudSession.players.length > 0) {
        const cloudTime = resolvedCloudSession.updatedAt || 0;
        const localTime = localSession.updatedAt || 0;
        if (cloudTime >= localTime) {
          saveActivePlayers(resolvedCloudSession.players, resolvedCloudSession.className || null, cloudTime || Date.now());
        } else if (localTime > cloudTime && localSession.players.length > 0) {
          syncUpstash(SHARED_ACTIVE_SESSION_KEY, localSession);
        }
      }
    } catch (e) {
      console.warn('[SharedClassSync] Error reconciling cloud active session:', e);
    }

    for (const className of Object.keys(playerSets)) {
      if (!classProfiles[className]) {
        classProfiles[className] = {
          schedule: parseScheduleFromName(className),
          units: [],
          updatedAt: 0
        };
        profilesChanged = true;
      } else if (!classProfiles[className].schedule) {
        classProfiles[className].schedule = parseScheduleFromName(className);
        profilesChanged = true;
      }
    }

    // Also include active session class if present and not yet in profiles
    const activeSession = getActiveSession();
    if (activeSession && activeSession.className) {
      const sessClass = activeSession.className;
      if (!playerSets[sessClass] && Array.isArray(activeSession.players) && activeSession.players.length > 0) {
        playerSets[sessClass] = activeSession.players;
        if (typeof localStorage !== 'undefined') {
          localStorage.setItem(SHARED_SETS_KEY, JSON.stringify(playerSets));
        }
      }
      if (!classProfiles[sessClass]) {
        classProfiles[sessClass] = {
          schedule: parseScheduleFromName(sessClass),
          units: [],
          updatedAt: 0
        };
        profilesChanged = true;
      }
    }

    // Reconcile latest cross-app active units into class profile ONLY when it belongs to that class or current class session
    const latestActiveUnits = getActiveUnits();
    if (latestActiveUnits && Array.isArray(latestActiveUnits.units) && latestActiveUnits.units.length > 0) {
      const scheduledMatch = findActiveScheduledClass(classProfiles);
      const targetClassNames = new Set();

      if (latestActiveUnits.className && classProfiles[latestActiveUnits.className]) {
        targetClassNames.add(latestActiveUnits.className);
      } else if (!latestActiveUnits.className && scheduledMatch && scheduledMatch.className) {
        const schedProf = classProfiles[scheduledMatch.className];
        if (isTimestampInCurrentClassSession(latestActiveUnits.updatedAt, scheduledMatch.className, schedProf)) {
          targetClassNames.add(scheduledMatch.className);
        }
      }

      for (const cName of targetClassNames) {
        const prof = classProfiles[cName];
        if (prof && (latestActiveUnits.updatedAt || 0) > (prof.updatedAt || 0)) {
          prof.units = [...latestActiveUnits.units];
          if (latestActiveUnits.curriculumId) {
            prof.curriculumId = latestActiveUnits.curriculumId;
          }
          prof.updatedAt = latestActiveUnits.updatedAt;
          profilesChanged = true;
        }
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

  function getActiveUnits() {
    let localData = { units: [], curriculumId: 'smart-phonics', className: '', updatedAt: 0 };
    if (typeof localStorage !== 'undefined') {
      try {
        const raw = localStorage.getItem(SHARED_ACTIVE_UNITS_KEY);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && Array.isArray(parsed.units)) {
            localData = {
              units: parsed.units,
              curriculumId: parsed.curriculumId || 'smart-phonics',
              className: parsed.className || '',
              updatedAt: parsed.updatedAt || 0
            };
          }
        }
      } catch {}
    }

    const cookie = readSharedSyncCookie();
    if (cookie && Array.isArray(cookie.actUnits) && cookie.actUnits.length > 0) {
      const cookieUpdatedAt = cookie.actUnitsAt || cookie.updatedAt || 0;
      if (cookieUpdatedAt > (localData.updatedAt || 0)) {
        localData = {
          units: cookie.actUnits,
          curriculumId: cookie.actCur || 'smart-phonics',
          className: cookie.actClass || localData.className || '',
          updatedAt: cookieUpdatedAt
        };
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(SHARED_ACTIVE_UNITS_KEY, JSON.stringify(localData));
          } catch {}
        }
      }
    }

    return localData;
  }

  async function saveActiveUnits(unitsArray, curriculumId = null, className = null, { skipClassProfile = false, customUpdatedAt = null } = {}) {
    const rawList = Array.isArray(unitsArray) ? unitsArray : [];
    const fallbackSeries = curriculumId
      ? (/^custom_/i.test(curriculumId) ? curriculumId : toSeriesSlug(curriculumId))
      : 'smart-phonics';
    const canonicals = rawList.map(u => {
      const c = toCanonicalUnit(u);
      if (c) {
        if (typeof u === 'string' && !u.includes(':') && !u.includes('|') && !u.includes('_L') && fallbackSeries !== 'smart-phonics') {
          return `${fallbackSeries}:L${c.level}U${c.unit}`;
        }
        return c.id;
      }
      return u;
    }).filter(Boolean);

    // Do not wipe shared active units or class profiles with an empty selection
    if (canonicals.length === 0) {
      return false;
    }

    let resolvedSeries = fallbackSeries;
    if (!curriculumId && canonicals.length > 0) {
      const firstC = toCanonicalUnit(canonicals[0]);
      if (firstC && firstC.series) resolvedSeries = firstC.series;
    }

    const resolvedClassName = typeof className === 'string' ? className.trim() : '';

    const now = typeof customUpdatedAt === 'number' && customUpdatedAt > 0 ? customUpdatedAt : Date.now();
    const payload = {
      units: canonicals,
      curriculumId: resolvedSeries,
      className: resolvedClassName,
      updatedAt: now
    };

    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(SHARED_ACTIVE_UNITS_KEY, JSON.stringify(payload));
      } catch {}
    }

    const cookieUpdates = {
      actUnits: canonicals,
      actCur: resolvedSeries,
      actUnitsAt: now
    };
    if (resolvedClassName) {
      cookieUpdates.actClass = resolvedClassName;
    }
    writeSharedSyncCookie(cookieUpdates);

    if (!skipClassProfile && canonicals.length > 0) {
      let profiles = {};
      if (typeof localStorage !== 'undefined') {
        try {
          profiles = JSON.parse(localStorage.getItem(SHARED_CLASS_PROFILES_KEY) || '{}');
        } catch {}
      }
      const targetClasses = new Set();
      if (resolvedClassName) {
        targetClasses.add(resolvedClassName);
      } else {
        const scheduledMatch = findActiveScheduledClass(profiles);
        if (scheduledMatch && scheduledMatch.className) {
          targetClasses.add(scheduledMatch.className);
        }
      }
      if (targetClasses.size > 0) {
        for (const cName of targetClasses) {
          if (!profiles[cName]) {
            profiles[cName] = {
              schedule: parseScheduleFromName(cName),
              units: [],
              curriculumId: resolvedSeries,
              updatedAt: now
            };
          }
          profiles[cName].units = canonicals;
          profiles[cName].curriculumId = resolvedSeries;
          profiles[cName].updatedAt = now;
        }
        if (typeof localStorage !== 'undefined') {
          try {
            localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(profiles));
          } catch {}
        }
        syncUpstash(SHARED_CLASS_PROFILES_KEY, profiles);
      }
    }

    return syncUpstash(SHARED_ACTIVE_UNITS_KEY, payload);
  }

  async function saveClassUnits(className, canonicalUnitsArray, curriculumId, customUpdatedAt = null) {
    if (!className) {
      return saveActiveUnits(canonicalUnitsArray, curriculumId, null, { customUpdatedAt });
    }
    let profiles = {};
    if (typeof localStorage !== 'undefined') {
      try {
        profiles = JSON.parse(localStorage.getItem(SHARED_CLASS_PROFILES_KEY) || '{}');
      } catch {}
    }

    const now = typeof customUpdatedAt === 'number' && customUpdatedAt > 0 ? customUpdatedAt : Date.now();

    if (!profiles[className]) {
      profiles[className] = {
        schedule: parseScheduleFromName(className),
        units: [],
        curriculumId: curriculumId || 'smart-phonics',
        updatedAt: now
      };
    }

    const resolveSlugOrCustom = (id) => {
      if (!id) return 'smart-phonics';
      return /^custom_/i.test(id) ? id : toSeriesSlug(id);
    };
    const series = curriculumId
      ? resolveSlugOrCustom(curriculumId)
      : (profiles[className].curriculumId ? resolveSlugOrCustom(profiles[className].curriculumId) : 'smart-phonics');

    const canonicals = (canonicalUnitsArray || []).map(u => {
      const c = toCanonicalUnit(u);
      if (c) {
        if (typeof u === 'string' && !u.includes(':') && !u.includes('|') && !u.includes('_L') && series !== 'smart-phonics') {
          return `${series}:L${c.level}U${c.unit}`;
        }
        return c.id;
      }
      return u;
    }).filter(Boolean);

    if (canonicals.length > 0 || !Array.isArray(profiles[className].units) || profiles[className].units.length === 0) {
      profiles[className].units = canonicals;
    }
    if (curriculumId) {
      profiles[className].curriculumId = series;
    } else if (!profiles[className].curriculumId && canonicals.length > 0) {
      const firstC = toCanonicalUnit(canonicals[0]);
      if (firstC && firstC.series) profiles[className].curriculumId = firstC.series;
    }
    profiles[className].updatedAt = now;

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(profiles));
    }

    if (canonicals.length > 0) {
      saveActiveUnits(canonicals, profiles[className].curriculumId || series, className, { skipClassProfile: true, customUpdatedAt: now });
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
  function getActiveSession() {
    let localPlayers = [];
    let localClass = '';
    let localUpdatedAt = 0;

    if (typeof localStorage !== 'undefined') {
      try {
        const stored = localStorage.getItem(SHARED_ACTIVE_PLAYERS_KEY);
        if (stored) localPlayers = JSON.parse(stored) || [];
        localClass = localStorage.getItem(SHARED_ACTIVE_CLASS_KEY) || '';
        localUpdatedAt = parseInt(localStorage.getItem(SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY) || '0', 10) || 0;
      } catch {}
    }

    const cookie = readSharedSyncCookie();
    const cookiePlayers = (cookie && Array.isArray(cookie.act)) ? cookie.act : [];
    const cookieClass = (cookie && cookie.actClass) || '';
    const cookieUpdatedAt = (cookie && (cookie.actUpdatedAt || cookie.updatedAt)) || 0;

    // Determine freshest source between localStorage and Cookie
    if (cookieUpdatedAt > localUpdatedAt && cookiePlayers.length > 0) {
      if (typeof localStorage !== 'undefined') {
        try {
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(cookiePlayers));
          if (cookieClass) {
            localStorage.setItem(SHARED_ACTIVE_CLASS_KEY, cookieClass);
          } else {
            localStorage.removeItem(SHARED_ACTIVE_CLASS_KEY);
          }
          localStorage.setItem(SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY, String(cookieUpdatedAt));
        } catch {}
      }
      return {
        players: cookiePlayers,
        className: cookieClass,
        updatedAt: cookieUpdatedAt
      };
    }

    if (localUpdatedAt > cookieUpdatedAt && localPlayers.length > 0) {
      writeSharedSyncCookie({
        act: localPlayers,
        actClass: localClass || undefined,
        actUpdatedAt: localUpdatedAt
      });
      return {
        players: localPlayers,
        className: localClass,
        updatedAt: localUpdatedAt
      };
    }

    const players = localPlayers.length > 0 ? localPlayers : cookiePlayers;
    const className = localClass || cookieClass || '';
    const updatedAt = Math.max(localUpdatedAt, cookieUpdatedAt);

    return {
      players,
      className,
      updatedAt
    };
  }

  function getActivePlayers() {
    return getActiveSession().players;
  }

  function saveActivePlayers(players, className = null, customUpdatedAt = null) {
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

    const updatedAt = typeof customUpdatedAt === 'number' && customUpdatedAt > 0
      ? customUpdatedAt
      : Date.now();

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_ACTIVE_PLAYERS_KEY, JSON.stringify(cleanPlayers));
      localStorage.setItem(SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY, String(updatedAt));
    }

    const sessionPayload = {
      players: cleanPlayers,
      className: cleanClassName || '',
      updatedAt
    };

    if (cleanPlayers.length > 0) {
      const updates = {
        act: cleanPlayers,
        actClass: cleanClassName || undefined,
        actUpdatedAt: updatedAt
      };
      if (cleanClassName) {
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
        delete cookie.actUpdatedAt;
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
    syncUpstash(SHARED_ACTIVE_SESSION_KEY, sessionPayload);
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

    inferTargetSound(unit) {
      if (!unit || typeof unit !== "object") return "";
      const rawTarget = unit.targetLetters || unit.targetSound || unit.sound;
      let tl = "";
      if (Array.isArray(rawTarget) && rawTarget.length) {
        tl = rawTarget.join(", ");
      } else if (typeof rawTarget === "string" && rawTarget.trim()) {
        tl = rawTarget.trim();
      } else if (unit.name) {
        const m = unit.name.match(/:\s*(.+)$/);
        if (m) {
          const candidate = m[1].trim();
          const longVowelMatch = candidate.match(/long\s+vowel\s+([a-z])/i);
          const shortVowelMatch = candidate.match(/short\s+vowel\s+([a-z])/i);
          if (longVowelMatch) {
            tl = `${longVowelMatch[1].toLowerCase()}_e`;
          } else if (shortVowelMatch) {
            tl = shortVowelMatch[1].toLowerCase();
          } else if (!/vowel/i.test(candidate)) {
            tl = candidate;
          }
        }
      }
      return tl;
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
          units: (lvl.units || []).map(unit => {
            const inferred = this.inferTargetSound(unit);
            return {
              ...unit,
              ...(inferred ? { targetSound: unit.targetSound || inferred } : {}),
              words: (unit.words || []).map(w => ({
                ...w,
                image: this.resolveUrl(w.image, activeBase),
                audio: this.resolveUrl(w.audio, activeBase)
              }))
            };
          })
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
          const tl = this.inferTargetSound(unit);
          if (tl) {
            cardList.push({ targetLetters: tl, targetSound: tl });
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

          const inferredSound = this.inferTargetSound(unit);
          bank[levelKey][unitKey] = {
            targetSound: unit.targetSound || inferredSound || '',
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
    },

    /**
     * Adapts canonical curriculum for Phonics Level Test ({ id, name, isCustom, levels: [...] })
     */
    toPhonicsLevelTest(data, mediaBase, seriesId) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) {
        return { id: 'smart-phonics', name: 'Smart Phonics', isCustom: false, levels: [] };
      }
      const targetSlug = seriesId ? toSeriesSlug(seriesId) : null;
      const sp = targetSlug
        ? (norm.series.find(s => toSeriesSlug(s.id) === targetSlug || toSeriesSlug(s.name) === targetSlug) || norm.series[0])
        : (norm.series.find(s => toSeriesSlug(s.id) === 'smart-phonics') || norm.series[0]);
      const activeBase = mediaBase || (getMediaBase() !== 'https://all-english-media.allenglish.link' ? getMediaBase() : (norm.mediaBase || getMediaBase()));

      const bookId = toSeriesSlug(sp.id || sp.name || 'smart-phonics');
      const isCustom = bookId !== 'smart-phonics';

      const defaultLetterDistractors = {
        a: ['a', 'b', 'c'],
        b: ['b', 'd', 'p'],
        c: ['c', 'k', 's'],
        d: ['d', 'b', 'p'],
        e: ['e', 'a', 'i'],
        f: ['f', 't', 'v'],
        g: ['g', 'j', 'c'],
        h: ['h', 'n', 'b'],
        i: ['i', 'e', 'l'],
        j: ['j', 'g', 'y'],
        k: ['k', 'c', 't'],
        l: ['l', 'i', 't'],
        m: ['m', 'n', 'w'],
        n: ['n', 'm', 'u'],
        o: ['o', 'a', 'u'],
        p: ['p', 'b', 'q'],
        q: ['q', 'p', 'g'],
        r: ['r', 'n', 'm'],
        s: ['s', 'c', 'z'],
        t: ['t', 'f', 'd'],
        u: ['u', 'v', 'o'],
        v: ['v', 'w', 'u'],
        w: ['w', 'm', 'v'],
        x: ['x', 's', 'z'],
        y: ['y', 'j', 'w'],
        z: ['z', 's', 'x']
      };

      const defaultCategories = {
        1: 'Alphabet (Letters & Sounds)',
        2: 'CVC Short Vowels',
        3: 'Long Vowels (Silent e & Vowel Pairs)',
        4: 'Blends & Digraphs',
        5: 'Diphthongs, Special Vowels & Silent Letters'
      };

      const defaultColors = {
        1: '#2563EB',
        2: '#059669',
        3: '#D97706',
        4: '#7C3AED',
        5: '#DC2626'
      };

      return {
        id: bookId,
        name: sp.name || toSeriesDisplayName(sp.id),
        description: sp.description || (isCustom ? '' : 'Standard 5-level ESL phonics curriculum'),
        isCustom,
        levels: (sp.levels || []).map((lvl, lIdx) => {
          const levelNumber = Number(lvl.levelNumber) || Number(lvl.bookNumber) || (lIdx + 1);
          const lvlId = lvl.id || `${bookId}_L${levelNumber}`;
          const lvlName = lvl.name || `Level ${levelNumber}`;
          const category = lvl.category || defaultCategories[levelNumber] || `Level ${levelNumber}`;
          const color = lvl.color || defaultColors[levelNumber] || '#2563EB';

          const units = (lvl.units || []).map((unit, uIdx) => {
            const uNumber = unit.unitNumber || (uIdx + 1);
            const uId = unit.id || `${lvlId}_U${uNumber}`;
            const uName = unit.name || `Unit ${uNumber}`;

            let targetSound = (this.inferTargetSound(unit) || '').trim();
            if (/^[aiou]\s*,\s*e$/i.test(targetSound)) {
              targetSound = targetSound.replace(/\s*,\s*/, '_').toLowerCase();
            }

            const words = (unit.words || []).map(w => {
              if (!w) return null;
              if (typeof w === 'string') {
                return { word: w };
              }
              const wordStr = w.word || w.label || '';
              if (!wordStr) return null;

              let label = w.label;
              if (!label) {
                if (w.image) {
                  const filename = w.image.split('/').pop().replace(/\.[^.]+$/, '');
                  if (filename) label = filename;
                } else if (w.imageAudio) {
                  const filename = w.imageAudio.split('/').pop().replace(/\.[^.]+$/, '');
                  if (filename) label = filename;
                }
              }
              if (!label) label = wordStr;

              let firstLetter = (w.firstLetter || '').toLowerCase();
              if (!firstLetter && label) {
                const match = label.match(/[a-z]/i);
                if (match) firstLetter = match[0].toLowerCase();
              }

              let choices = Array.isArray(w.choices) && w.choices.length >= 3 ? w.choices : null;
              if (!choices && firstLetter && defaultLetterDistractors[firstLetter]) {
                choices = [...defaultLetterDistractors[firstLetter]];
              }
              if (!choices) {
                choices = [firstLetter || 'a', 'b', 'c'];
              }

              const resWord = {
                word: wordStr,
                label,
                firstLetter,
                choices
              };
              if (w.image) {
                resWord.image = this.resolveUrl(w.image, activeBase);
              }
              if (w.audio) {
                resWord.audio = this.resolveUrl(w.audio, activeBase);
              }
              if (w.imageAudio) {
                resWord.imageAudio = this.resolveUrl(w.imageAudio, activeBase);
              }
              return resWord;
            }).filter(Boolean);

            const sightWords = (unit.sightWords || []).map(sw => {
              if (typeof sw === 'string') return { word: sw };
              if (typeof sw === 'object' && sw && sw.word) return { word: sw.word };
              return null;
            }).filter(Boolean);

            const extraWords = (unit.extraWords || []).map(ew => {
              if (typeof ew === 'string') return { word: ew };
              if (typeof ew === 'object' && ew && ew.word) return { word: ew.word };
              return null;
            }).filter(Boolean);

            return {
              id: uId,
              name: uName,
              targetSound,
              words,
              sightWords,
              extraWords
            };
          });

          return {
            id: lvlId,
            levelNumber,
            name: lvlName,
            category,
            color,
            unitCount: units.length,
            units
          };
        })
      };
    },

    /**
     * Adapts all series for Phonics Level Test ([ { id, name, isCustom, levels: [...] }, ... ])
     */
    toPhonicsLevelTestAll(data, mediaBase) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return [];
      return norm.series.map(s => this.toPhonicsLevelTest(data, mediaBase, s.id));
    }
  };

  // ── 7. Unified Curriculum Loader & Delta Overrides ─────────────
  function computeCurriculumOverrides(curriculaList, baselineData) {
    if (!Array.isArray(curriculaList) || curriculaList.length === 0) return [];
    const baseNorm = baselineData ? CurriculumAdapter.normalize(baselineData) : null;
    const masterSeriesList = Array.isArray(baseNorm?.series) ? baseNorm.series : [];
    const masterById = new Map(masterSeriesList.map(s => [s.id, s]));

    const overrides = [];
    for (const s of curriculaList) {
      if (!s || !s.id) continue;
      const masterSeries = masterById.get(s.id);
      if (s.isCustom || !masterSeries) {
        overrides.push({
          seriesId: s.id,
          name: s.name || s.id,
          isCustom: true,
          description: s.description || '',
          levelsJson: JSON.stringify(s.levels || []),
          updatedAt: s.updatedAt || Date.now()
        });
      } else {
        const masterUnitMap = new Map();
        for (const lvl of (masterSeries.levels || [])) {
          const lNum = lvl.level ?? lvl.id;
          for (const u of (lvl.units || [])) {
            const uNum = u.unit ?? u.unitNumber ?? u.id;
            masterUnitMap.set(`${lNum}:${uNum}`, JSON.stringify(u));
          }
        }

        const diffLevels = [];
        for (const lvl of (s.levels || [])) {
          const lNum = lvl.level ?? lvl.id;
          const diffUnits = [];
          for (const u of (lvl.units || [])) {
            const uNum = u.unit ?? u.unitNumber ?? u.id;
            const key = `${lNum}:${uNum}`;
            if (masterUnitMap.get(key) !== JSON.stringify(u)) {
              diffUnits.push(u);
            }
          }
          if (diffUnits.length > 0) {
            diffLevels.push({ ...lvl, units: diffUnits });
          }
        }

        if (diffLevels.length > 0) {
          overrides.push({
            seriesId: s.id,
            name: s.name || masterSeries.name || s.id,
            isCustom: false,
            description: s.description || masterSeries.description || '',
            levelsJson: JSON.stringify(diffLevels),
            updatedAt: s.updatedAt || Date.now()
          });
        }
      }
    }
    return overrides;
  }

  function applyCurriculumOverrides(baseNormalized, overridesList) {
    if (!baseNormalized || !Array.isArray(baseNormalized.series)) return baseNormalized;
    if (!Array.isArray(overridesList) || overridesList.length === 0) return baseNormalized;

    const cloned = JSON.parse(JSON.stringify(baseNormalized));
    const seriesById = new Map(cloned.series.map(s => [s.id, s]));

    for (const ov of overridesList) {
      if (!ov || !ov.seriesId || !ov.levelsJson) continue;
      let parsedLevels = [];
      try {
        parsedLevels = JSON.parse(ov.levelsJson);
      } catch {
        continue;
      }
      if (!Array.isArray(parsedLevels)) continue;

      const targetSeries = seriesById.get(ov.seriesId);
      if (ov.isCustom || !targetSeries) {
        const customEntry = {
          id: ov.seriesId,
          name: ov.name || ov.seriesId,
          isCustom: true,
          description: ov.description || '',
          updatedAt: ov.updatedAt || Date.now(),
          levels: parsedLevels
        };
        if (targetSeries) {
          Object.assign(targetSeries, customEntry);
        } else {
          cloned.series.push(customEntry);
          seriesById.set(ov.seriesId, customEntry);
        }
      } else {
        targetSeries.updatedAt = Math.max(targetSeries.updatedAt || 0, ov.updatedAt || 0);
        const levelByNum = new Map((targetSeries.levels || []).map(l => [String(l.level ?? l.id), l]));
        for (const ovLvl of parsedLevels) {
          const lKey = String(ovLvl.level ?? ovLvl.id);
          const targetLvl = levelByNum.get(lKey);
          if (!targetLvl) {
            targetSeries.levels.push(ovLvl);
            levelByNum.set(lKey, ovLvl);
          } else {
            const unitByIdx = new Map();
            (targetLvl.units || []).forEach((u, idx) => {
              unitByIdx.set(String(u.unit ?? u.unitNumber ?? u.id), idx);
            });
            for (const ovUnit of (ovLvl.units || [])) {
              const uKey = String(ovUnit.unit ?? ovUnit.unitNumber ?? ovUnit.id);
              if (unitByIdx.has(uKey)) {
                targetLvl.units[unitByIdx.get(uKey)] = ovUnit;
              } else {
                targetLvl.units.push(ovUnit);
              }
            }
          }
        }
      }
    }

    return CurriculumAdapter.normalize(cloned) || cloned;
  }

  async function saveCurriculumOverridesToConvex({ overrides = [], hideBuiltIn = false, activeCurriculumId = 'smart-phonics', replaceAll = true } = {}) {
    if (typeof localStorage !== 'undefined') {
      try {
        localStorage.setItem(CONVEX_CURRICULUM_OVERRIDES_KEY, JSON.stringify(overrides));
      } catch {}
    }
    CurriculumLoader.cachedCurriculum = null;

    const { syncCode, pin } = getSyncConfig();
    if (!syncCode) return false;

    const args = {
      syncCode,
      hideBuiltIn: Boolean(hideBuiltIn),
      activeCurriculumId: String(activeCurriculumId || 'smart-phonics'),
      overrides,
      replaceAll: Boolean(replaceAll)
    };
    if (pin) args.pin = pin;

    const res = await convexMutation('sync:saveCurriculumOverrides', args);
    return Boolean(res && res.ok);
  }

  const CurriculumLoader = {
    cachedCurriculum: null,
    cachedMasterCurriculum: null,

    /**
     * Load Master Built-In Curriculum (CDN -> Local Fallback) and overlay Per-Teacher Convex Overrides
     */
    async load({ cdnBase = null, fallbackData = null, forceRefresh = false } = {}) {
      if (this.cachedCurriculum && !forceRefresh) {
        return this.cachedCurriculum;
      }

      let baseNormalized = null;

      // 1. Fetch master built-in curriculum.json from CDN (GitHub/Netlify)
      try {
        const cleanCdn = (cdnBase || getMediaBase()).replace(/\/$/, '');
        const res = await fetch(`${cleanCdn}/curriculum.json?v=2.0`);
        if (res.ok) {
          const cdnJson = await res.json();
          baseNormalized = CurriculumAdapter.normalize(cdnJson);
          if (baseNormalized) {
            this.cachedMasterCurriculum = JSON.parse(JSON.stringify(baseNormalized));
          }
        }
      } catch (e) {
        console.warn('[CurriculumLoader] CDN fetch failed, falling back to local bundle:', e);
      }

      // 2. Bundled offline fallback if CDN unreachable
      if (!baseNormalized && fallbackData) {
        baseNormalized = CurriculumAdapter.normalize(fallbackData);
        if (baseNormalized && !this.cachedMasterCurriculum) {
          this.cachedMasterCurriculum = JSON.parse(JSON.stringify(baseNormalized));
        }
      }

      // 3. Overlay per-teacher custom curriculum overrides from Convex (or localStorage cache)
      let overrides = [];
      if (typeof localStorage !== 'undefined') {
        try {
          overrides = JSON.parse(localStorage.getItem(CONVEX_CURRICULUM_OVERRIDES_KEY) || '[]') || [];
        } catch {}
      }

      try {
        const cloudOverrides = await fetchUpstash(UPSTASH_SHARED_CURRICULUM_KEY);
        if (Array.isArray(cloudOverrides)) {
          overrides = cloudOverrides;
        }
      } catch (e) {
        console.warn('[CurriculumLoader] Cloud curriculum override check skipped:', e);
      }

      if (baseNormalized) {
        const merged = applyCurriculumOverrides(baseNormalized, overrides);
        this.cachedCurriculum = merged;
        return merged;
      }

      return null;
    }
  };

  // Reconcile cookie with localStorage on load and start live Convex subscription if connected
  try {
    reconcileCookieWithLocalStorage();
    startLiveSubscription();
  } catch (e) {
    console.warn('[SharedClassSync] Initial cookie reconciliation error:', e);
  }

  return {
    SHARED_SETS_KEY,
    SHARED_ACTIVE_PLAYERS_KEY,
    SHARED_ACTIVE_PLAYERS_UPDATED_AT_KEY,
    SHARED_ACTIVE_SESSION_KEY,
    SHARED_CLASS_PROFILES_KEY,
    CONVEX_SYNC_CODE_KEY,
    CONVEX_SYNC_PIN_KEY,
    CONVEX_CURRICULUM_OVERRIDES_KEY,
    UPSTASH_URL_KEY,
    UPSTASH_TOKEN_KEY,
    UPSTASH_SHARED_CURRICULUM_KEY,
    DEFAULT_MEDIA_BASE,
    getMediaBase,
    getConvexUrl,
    normalizeSyncCode,
    getSyncConfig,
    saveSyncConfig,
    clearSyncConfig,
    createSyncWorkspace,
    connectSyncWorkspace,
    syncNow,
    convexQuery,
    convexMutation,
    computeCurriculumOverrides,
    applyCurriculumOverrides,
    saveCurriculumOverridesToConvex,
    schedulePushToConvex,
    pushLocalStateToConvex,
    parseScheduleFromName,
    findActiveScheduledClass,
    isTimestampInCurrentClassSession,
    toSeriesSlug,
    toPascalCase,
    toSeriesDisplayName,
    toCanonicalUnit,
    toPhonicsFlash,
    toPhonicsLevelTest: (data, mediaBase, seriesId) => CurriculumAdapter.toPhonicsLevelTest(data, mediaBase, seriesId),
    toPhonicsLevelTestAll: (data, mediaBase) => CurriculumAdapter.toPhonicsLevelTestAll(data, mediaBase),
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
    SHARED_ACTIVE_UNITS_KEY,
    getActiveUnits,
    saveActiveUnits,
    getActivePlayers,
    getActiveSession,
    saveActivePlayers,
    clearActivePlayers,
    resolveClassRoster,
    inferTargetSound: (unit) => CurriculumAdapter.inferTargetSound(unit),
    CurriculumAdapter,
    CurriculumLoader
  };
});
