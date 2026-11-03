/** 纯计费函数。时间按设置里的 IANA 时区解释，不依赖浏览器本地时区。 */

export const STORAGE_KEY = 'work-wage.settings.v1'

export const DEFAULT_SETTINGS = {
  start: '09:00',
  end: '18:00',
  lunchStart: '12:00',
  lunchEnd: '13:30',
  /** double 双休；single 周六上班周日休；alternate 大小周 */
  restMode: 'double',
  /** 仅 alternate：包含今天的这一周是小周还是大周 */
  anchorWeek: 'small',
  salary: 10000,
  timeZone: 'Asia/Shanghai',
}

function clampMinute(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value ?? '').trim())
  if (!match) return null
  const hour = Number(match[1])
  const minute = Number(match[2])
  if (hour > 23 || minute > 59) return null
  return hour * 60 + minute
}

function partsInZone(date, timeZone) {
  const bag = {}
  for (const part of new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
  }).formatToParts(date)) {
    if (part.type !== 'literal') bag[part.type] = part.value
  }
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[bag.weekday]
  return {
    year: Number(bag.year),
    month: Number(bag.month),
    day: Number(bag.day),
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    second: Number(bag.second),
    seconds: Number(bag.hour) * 3600 + Number(bag.minute) * 60 + Number(bag.second),
    weekday,
  }
}

function daysInMonth(year, month) {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

/** 该月第 1 天的 ISO 星期。公历可用，不依赖运行时区。 */
function firstWeekday(year, month) {
  const js = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
  return js === 0 ? 7 : js
}

function weekdayOf(year, month, day) {
  return ((firstWeekday(year, month) - 1 + day - 1) % 7) + 1
}

/** 从本周一数到目标周一，相差几周。今天所在周为 0。 */
function weeksFromToday(today, year, month, day) {
  const todayIndex = (today.day - 1) - (today.weekday - 1)
  const targetIndex = (day - 1) - (weekdayOf(year, month, day) - 1)
  return Math.round((targetIndex - todayIndex) / 7)
}

function isRestDay(year, month, day, settings, today) {
  const weekday = weekdayOf(year, month, day)
  if (settings.restMode === 'single') return weekday === 7
  if (settings.restMode === 'alternate') {
    const small = settings.anchorWeek !== 'big'
    const smallWeek = (weeksFromToday(today, year, month, day) + (small ? 0 : 1)) % 2 === 0
    return smallWeek ? weekday >= 6 : weekday === 7
  }
  return weekday >= 6
}

export function normalizeSettings(raw) {
  const next = { ...DEFAULT_SETTINGS }
  if (!raw || typeof raw !== 'object') return { settings: next, error: '' }
  if (typeof raw.start === 'string') next.start = raw.start
  if (typeof raw.end === 'string') next.end = raw.end
  if (typeof raw.lunchStart === 'string') next.lunchStart = raw.lunchStart
  if (typeof raw.lunchEnd === 'string') next.lunchEnd = raw.lunchEnd
  if (typeof raw.timeZone === 'string' && raw.timeZone.trim()) next.timeZone = raw.timeZone.trim()
  if (raw.restMode === 'single' || raw.restMode === 'alternate' || raw.restMode === 'double') next.restMode = raw.restMode
  else if (Array.isArray(raw.restDays)) next.restMode = raw.restDays.includes(6) ? 'double' : 'single'
  if (raw.anchorWeek === 'big' || raw.anchorWeek === 'small') next.anchorWeek = raw.anchorWeek
  const salary = Number(raw.salary)
  if (Number.isFinite(salary) && salary >= 0) next.salary = salary
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: next.timeZone }).format(new Date())
  } catch {
    next.timeZone = DEFAULT_SETTINGS.timeZone
  }
  return { settings: next, error: validateSettings(next) }
}

export function validateSettings(settings) {
  const start = clampMinute(settings.start)
  const end = clampMinute(settings.end)
  const lunchStart = clampMinute(settings.lunchStart)
  const lunchEnd = clampMinute(settings.lunchEnd)
  if (start == null || end == null || lunchStart == null || lunchEnd == null) return '时间请用 24 小时制，例如 09:00。'
  if (end <= start) return '第一版不支持跨午夜，下班必须晚于上班。'
  if (lunchEnd < lunchStart) return '午休结束必须不早于午休开始。'
  if (!(lunchStart >= start && lunchEnd <= end)) return '午休必须落在上下班之间。'
  if (end - start - (lunchEnd - lunchStart) <= 0) return '扣掉午休后没有可计费时间。'
  if (!Number.isFinite(settings.salary) || settings.salary < 0) return '月薪必须是大于等于 0 的数字。'
  if (!['double', 'single', 'alternate'].includes(settings.restMode)) return '休息制度无效。'
  return ''
}

export function workdaysInMonth(year, month, settings, today) {
  const total = daysInMonth(year, month)
  let count = 0
  for (let day = 1; day <= total; day += 1) {
    if (!isRestDay(year, month, day, settings, today)) count += 1
  }
  return count
}

function netSeconds(settings) {
  const start = clampMinute(settings.start)
  const end = clampMinute(settings.end)
  const lunchStart = clampMinute(settings.lunchStart)
  const lunchEnd = clampMinute(settings.lunchEnd)
  return (end - start - (lunchEnd - lunchStart)) * 60
}

/** 从上班时刻到 now 的已计费秒数。午休和班外不计。 */
export function billedSeconds(now, settings) {
  const clock = partsInZone(now, settings.timeZone)
  if (isRestDay(clock.year, clock.month, clock.day, settings, clock)) return 0
  const start = clampMinute(settings.start) * 60
  const end = clampMinute(settings.end) * 60
  const lunchStart = clampMinute(settings.lunchStart) * 60
  const lunchEnd = clampMinute(settings.lunchEnd) * 60
  const t = Math.min(Math.max(clock.seconds, start), end)
  const morning = Math.max(0, Math.min(t, lunchStart) - start)
  const afternoon = Math.max(0, t - Math.max(lunchEnd, start))
  return morning + afternoon
}

function formatClock(total) {
  const sign = total < 0 ? '-' : ''
  const value = Math.abs(total)
  const hour = Math.floor(value / 3600)
  const minute = Math.floor((value % 3600) / 60)
  const second = value % 60
  return `${sign}${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`
}

export function quote(now, settings) {
  const error = validateSettings(settings)
  const empty = {
    error,
    ticking: false,
    today: 0,
    month: 0,
    perSecond: 0,
    workdays: 0,
    countdownLabel: '未设置',
    countdown: '--:--:--',
    status: '未设置',
    weekLabel: '',
  }
  if (error) return empty
  const clock = partsInZone(now, settings.timeZone)
  const workdays = workdaysInMonth(clock.year, clock.month, settings, clock)
  const daily = netSeconds(settings)
  const perSecond = workdays > 0 && daily > 0 ? settings.salary / workdays / daily : 0
  const todaySeconds = billedSeconds(now, settings)
  const resting = isRestDay(clock.year, clock.month, clock.day, settings, clock)
  const start = clampMinute(settings.start) * 60
  const end = clampMinute(settings.end) * 60
  const lunchStart = clampMinute(settings.lunchStart) * 60
  const lunchEnd = clampMinute(settings.lunchEnd) * 60
  let workedDays = 0
  for (let day = 1; day < clock.day; day += 1) {
    if (!isRestDay(clock.year, clock.month, day, settings, clock)) workedDays += 1
  }
  let status = '工作中'
  let ticking = true
  let countdownLabel = '距下班'
  let countdown = formatClock(end - clock.seconds)
  if (resting) {
    status = '周休'
    ticking = false
    countdownLabel = '今日休息'
    countdown = '00:00:00'
  } else if (clock.seconds < start) {
    status = '未上班'
    ticking = false
    countdownLabel = '距上班'
    countdown = formatClock(start - clock.seconds)
  } else if (clock.seconds >= lunchStart && clock.seconds < lunchEnd) {
    status = '午休'
    ticking = false
  } else if (clock.seconds >= end) {
    status = '已下班'
    ticking = false
    countdownLabel = '已下班'
    countdown = '00:00:00'
  }
  const small = settings.anchorWeek !== 'big'
  const smallWeek = settings.restMode === 'alternate' && (0 + (small ? 0 : 1)) % 2 === 0
  const weekLabel = settings.restMode === 'alternate' ? (smallWeek ? '本周小周' : '本周大周') : ''
  return {
    error: '',
    ticking,
    today: todaySeconds * perSecond,
    month: (workedDays * daily + todaySeconds) * perSecond,
    perSecond,
    workdays,
    countdownLabel,
    countdown,
    status,
    weekLabel,
  }
}

export function formatMoney(value) {
  return new Intl.NumberFormat('zh-CN', {
    style: 'currency',
    currency: 'CNY',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number.isFinite(value) ? value : 0)
}

export function loadSettings() {
  try {
    return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')).settings
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

export function saveSettings(settings) {
  const { settings: next } = normalizeSettings(settings)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  window.dispatchEvent(new CustomEvent('work-wage:settings', { detail: next }))
  return next
}
