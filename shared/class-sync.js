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
  const SHARED_CLASS_PROFILES_KEY = 'shared_class_profiles';
  const UPSTASH_URL_KEY = 'upstash_redis_url';
  const UPSTASH_TOKEN_KEY = 'upstash_redis_token';
  const UPSTASH_SHARED_CURRICULUM_KEY = 'shared_phonics_curriculum';
  
  function getMediaBase() {
    if (typeof window !== 'undefined') {
      if (window.ALL_ENGLISH_MEDIA_BASE) return window.ALL_ENGLISH_MEDIA_BASE;
      if (typeof localStorage !== 'undefined') {
        const stored = localStorage.getItem('all_english_media_base');
        if (stored) return stored;
      }
    }
    return 'https://all-english-media.netlify.app';
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

  // ── 3. Universal Smart Phonics Unit Translators ────────────────
  function toCanonicalUnit(unitStr) {
    if (!unitStr) return null;
    if (typeof unitStr === 'object') {
      const level = parseInt(unitStr.level || unitStr.book, 10);
      const unit = parseInt(unitStr.unit || (typeof unitStr.unitName === 'string' ? unitStr.unitName.match(/Unit\s+(\d+)/i)?.[1] : null), 10);
      if (!isNaN(level) && !isNaN(unit)) {
        const series = unitStr.series || 'SmartPhonics';
        return { series, level, unit, id: `L${level}U${unit}` };
      }
      return null;
    }
    if (typeof unitStr !== 'string') return null;
    const str = unitStr.trim();

    // 1. Phonics Flash: L2U3
    let m = str.match(/L(\d+)U(\d+)/i);
    if (m) {
      return { series: 'SmartPhonics', level: parseInt(m[1], 10), unit: parseInt(m[2], 10), id: `L${m[1]}U${m[2]}` };
    }

    // 2. Word-Tac-Toe: Book2|Unit3
    m = str.match(/Book(\d+)\|Unit(\d+)/i);
    if (m) {
      return { series: 'SmartPhonics', level: parseInt(m[1], 10), unit: parseInt(m[2], 10), id: `L${m[1]}U${m[2]}` };
    }

    // 3. MatchMaker: SmartPhonics|2|3 or LetsSmile|2|3 or LS|2|3
    m = str.match(/(?:SmartPhonics|SP|LetsSmile|LS)\|(\d+)\|(\d+)/i);
    if (m) {
      const isLS = /^(?:LetsSmile|LS)/i.test(str);
      const series = isLS ? 'LetsSmile' : 'SmartPhonics';
      return { series, level: parseInt(m[1], 10), unit: parseInt(m[2], 10), id: `L${m[1]}U${m[2]}` };
    }

    // 4. Treasure Hunt: level2:unit3
    m = str.match(/level(\d+):unit(\d+)/i);
    if (m) {
      return { series: 'SmartPhonics', level: parseInt(m[1], 10), unit: parseInt(m[2], 10), id: `L${m[1]}U${m[2]}` };
    }

    return null;
  }

  function toPhonicsFlash(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    return c ? `L${c.level}U${c.unit}` : null;
  }

  function toTicTacToe(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    return c ? `Book${c.level}|Unit${c.unit}` : null;
  }

  function toMatchMaker(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    const prefix = c.series === 'LetsSmile' ? 'LetsSmile' : 'SmartPhonics';
    return c ? `${prefix}|${c.level}|${c.unit}` : null;
  }

  function toTreasureHunt(canonical) {
    if (!canonical) return null;
    const c = typeof canonical === 'string' ? toCanonicalUnit(canonical) : canonical;
    return c ? `level${c.level}:unit${c.unit}` : null;
  }

  function getHighestUnit(unitsArray) {
    if (!Array.isArray(unitsArray) || unitsArray.length === 0) return null;
    const parsed = unitsArray.map(toCanonicalUnit).filter(Boolean);
    if (parsed.length === 0) return null;

    parsed.sort((a, b) => {
      if (b.level !== a.level) return b.level - a.level;
      return b.unit - a.unit;
    });

    return parsed[0];
  }

  // ── 4. Upstash REST API Helper ─────────────────────────────────
  function getCredentials() {
    let url = '';
    let token = '';

    if (typeof localStorage !== 'undefined') {
      url = localStorage.getItem(UPSTASH_URL_KEY) || '';
      token = localStorage.getItem(UPSTASH_TOKEN_KEY) || '';
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

    profiles[className].units = canonicalUnitsArray;
    if (curriculumId) {
      profiles[className].curriculumId = curriculumId;
    }
    profiles[className].updatedAt = Date.now();

    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(SHARED_CLASS_PROFILES_KEY, JSON.stringify(profiles));
    }
    return syncUpstash(SHARED_CLASS_PROFILES_KEY, profiles);
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
      if (path.startsWith('http://') || path.startsWith('https://') || path.startsWith('data:') || path.startsWith('blob:')) {
        return path;
      }
      const cleanPath = path.replace(/^(\.\/|data\/|media\/)/, '');
      const cleanBase = (base || getMediaBase()).replace(/\/$/, '');
      return `${cleanBase}/${cleanPath}`;
    },

    /**
     * Adapts canonical curriculum for Phonics Flash ({ levels: [...] })
     */
    toPhonicsFlash(data, mediaBase) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return { levels: [] };
      const sp = norm.series.find(s => s.id === 'smart-phonics') || norm.series[0];
      const activeBase = mediaBase || (getMediaBase() !== 'https://all-english-media.netlify.app' ? getMediaBase() : (norm.mediaBase || getMediaBase()));

      return {
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
     * Adapts canonical curriculum for MatchMaker ({ 1: { "Unit 1: abc": [...] } })
     */
    toMatchMaker(data, mediaBase) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return {};
      const sp = norm.series.find(s => s.id === 'smart-phonics') || norm.series[0];
      const activeBase = mediaBase || (getMediaBase() !== 'https://all-english-media.netlify.app' ? getMediaBase() : (norm.mediaBase || getMediaBase()));
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
     * Adapts canonical curriculum for Sunken Treasure & Tic-Tac-Toe ({ level1: { unit1: {...} } })
     */
    toWordBank(data) {
      const norm = this.normalize(data);
      if (!norm || !norm.series || norm.series.length === 0) return {};
      const sp = norm.series.find(s => s.id === 'smart-phonics') || norm.series[0];
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
          if (bookNum === 1 && unit.targetLetters && unit.targetLetters.length) {
            title = unit.targetLetters.join('').toUpperCase();
          }

          let words = [];
          let extraWords = [];

          if (bookNum === 1 && unit.targetLetters && unit.targetLetters.length) {
            for (const l of unit.targetLetters) {
              words.push(l.toUpperCase(), l.toLowerCase());
              extraWords.push(l.toUpperCase() + l.toLowerCase());
            }
          } else {
            words = [...new Set((unit.words || []).map(w => typeof w === 'string' ? w : w.word))];
            extraWords = (unit.extraWords || []).map(w => typeof w === 'string' ? w : (w.word || ''));
          }

          bank[levelKey][unitKey] = {
            targetSound: unit.targetSound || '',
            unitTitle: title || `Unit ${unitNum}`,
            words,
            extraWords
          };
        }
      }
      return bank;
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
    toCanonicalUnit,
    toPhonicsFlash,
    toTicTacToe,
    toMatchMaker,
    toTreasureHunt,
    getHighestUnit,
    getCredentials,
    fetchUpstash,
    syncUpstash,
    loadAllClasses,
    saveClassUnits,
    CurriculumAdapter,
    CurriculumLoader
  };
});
