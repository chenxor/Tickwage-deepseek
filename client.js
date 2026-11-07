window.__ModuleLoader__.load({
  id: '@local/work-wage',
  factory(require) {
    const React = require('react')


    const STORAGE_KEY = 'work-wage.settings.v1'

    const DEFAULT_SETTINGS = {
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

    function firstWeekday(year, month) {
      const js = new Date(Date.UTC(year, month - 1, 1)).getUTCDay()
      return js === 0 ? 7 : js
    }

    function weekdayOf(year, month, day) {
      return ((firstWeekday(year, month) - 1 + day - 1) % 7) + 1
    }

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
        // 小周是单休周：周六照常上班，只有周日休息；大周才是双休。
        return smallWeek ? weekday === 7 : weekday >= 6
      }
      return weekday >= 6
    }

    function normalizeSettings(raw) {
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

    function validateSettings(settings) {
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

    function workdaysInMonth(year, month, settings, today) {
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

    function billedSeconds(now, settings) {
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

    function quote(now, settings) {
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

    function formatMoney(value) {
      return new Intl.NumberFormat('zh-CN', {
        style: 'currency',
        currency: 'CNY',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(Number.isFinite(value) ? value : 0)
    }

    function loadSettings() {
      try {
        return normalizeSettings(JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')).settings
      } catch {
        return { ...DEFAULT_SETTINGS }
      }
    }

    function saveSettings(settings) {
      const { settings: next } = normalizeSettings(settings)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
      window.dispatchEvent(new CustomEvent('work-wage:settings', { detail: next }))
      return next
    }

    const h = React.createElement
    const css = `
      .ww, .ww * { box-sizing: border-box; }
      .ww { position: fixed; z-index: 40; right: 18px; bottom: 18px; width: 280px; pointer-events: auto; color: var(--dsw-alias-fg, inherit); font: 13px/1.45 inherit; }
      .ww-shell { overflow: hidden; border: 1px solid color-mix(in srgb, var(--dsw-alias-fg, CanvasText) 10%, transparent); border-radius: 18px; background: var(--dsw-alias-bg-elevated, Canvas); box-shadow: 0 16px 40px color-mix(in srgb, var(--dsw-alias-fg, CanvasText) 16%, transparent); }
      .ww-bar { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 8px 8px 8px 14px; cursor: grab; user-select: none; }
      .ww-bar:active { cursor: grabbing; }
      .ww-bar b { font-size: 15px; font-weight: 680; font-variant-numeric: tabular-nums; letter-spacing: -0.02em; }
      .ww-bar span { color: var(--dsw-alias-fg-muted, currentColor); }
      .ww-grow { flex: 1; }
      .ww-nav, .ww-quiet, .ww-save { height: 28px; padding: 0 10px; border: 0; border-radius: 999px; font: inherit; cursor: pointer; }
      .ww-nav, .ww-save { background: var(--dsw-alias-accent, #3b6cff); color: var(--dsw-alias-accent-fg, #fff); }
      .ww-quiet { background: transparent; color: var(--dsw-alias-fg-muted, currentColor); }
      .ww-body { padding: 2px 16px 16px; }
      .ww-kicker { margin: 0; color: var(--dsw-alias-fg-muted, currentColor); font-size: 12px; }
      .ww-money { margin: 2px 0 0; font-size: 36px; font-weight: 680; line-height: 1.05; letter-spacing: -0.03em; font-variant-numeric: tabular-nums; }
      .ww-count { margin: 4px 0 14px; color: var(--dsw-alias-fg-muted, currentColor); font-variant-numeric: tabular-nums; }
      .ww-count b { color: var(--dsw-alias-fg, inherit); font-weight: 650; }
      .ww-split { display: grid; grid-template-columns: 1fr 1fr; border-top: 1px solid color-mix(in srgb, var(--dsw-alias-fg, CanvasText) 8%, transparent); }
      .ww-split div { padding-top: 10px; }
      .ww-split div + div { padding-left: 12px; border-left: 1px solid color-mix(in srgb, var(--dsw-alias-fg, CanvasText) 8%, transparent); }
      .ww-split span { display: block; color: var(--dsw-alias-fg-muted, currentColor); font-size: 11px; }
      .ww-split b { display: block; margin-top: 2px; font-variant-numeric: tabular-nums; }
      .ww-section { margin: 12px 0 6px; color: var(--dsw-alias-fg-muted, currentColor); font-size: 11px; }
      .ww-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .ww-field { display: flex; flex-direction: column; gap: 4px; }
      .ww-field.wide { grid-column: 1 / -1; }
      .ww-field span { color: var(--dsw-alias-fg-muted, currentColor); font-size: 11px; }
      .ww-field input { width: 100%; height: 32px; padding: 0 8px; border: 1px solid color-mix(in srgb, var(--dsw-alias-fg, CanvasText) 12%, transparent); border-radius: 9px; background: var(--dsw-alias-bg, Canvas); color: inherit; font: inherit; }
      .ww-choice { display: flex; gap: 6px; }
      .ww-choice button { flex: 1; height: 32px; border: 1px solid color-mix(in srgb, var(--dsw-alias-fg, CanvasText) 12%, transparent); border-radius: 9px; background: transparent; color: inherit; font: inherit; cursor: pointer; }
      .ww-choice button[aria-pressed="true"] { border-color: transparent; background: var(--dsw-alias-accent, #3b6cff); color: var(--dsw-alias-accent-fg, #fff); }
      .ww-foot { display: flex; justify-content: space-between; align-items: center; margin-top: 12px; }
      .ww-error { margin: 8px 0 0; color: var(--dsw-alias-fg-danger, #c24141); font-size: 12px; }
    `
    function useNow() {
      const [now, setNow] = React.useState(() => new Date())
      React.useEffect(() => {
        const timer = window.setInterval(() => setNow(new Date()), 1000)
        return () => window.clearInterval(timer)
      }, [])
      return now
    }
    function useSettings() {
      const [settings, setSettings] = React.useState(() => loadSettings())
      React.useEffect(() => {
        const onChange = (event) => setSettings(event.detail)
        window.addEventListener('work-wage:settings', onChange)
        return () => window.removeEventListener('work-wage:settings', onChange)
      }, [])
      return settings
    }
    function Field(props) {
      return h('label', { className: props.wide ? 'ww-field wide' : 'ww-field' },
        h('span', null, props.label),
        h('input', { type: props.type || 'text', value: props.value, onChange: (event) => props.onChange(event.target.value) }))
    }
    function Choice(props) {
      return h('div', { className: 'ww-choice' }, props.options.map((item) => h('button', {
        key: item.value, type: 'button', 'aria-pressed': props.value === item.value, onClick: () => props.onChange(item.value),
      }, item.label)))
    }
    function Widget() {
      const now = useNow()
      const saved = useSettings()
      const rootRef = React.useRef(null)
      const dragRef = React.useRef(null)
      const [page, setPage] = React.useState('closed')
      const [pos, setPos] = React.useState(null)
      const [draft, setDraft] = React.useState(saved)
      const [error, setError] = React.useState('')
      React.useEffect(() => setDraft(saved), [saved])
      const view = quote(now, saved)
      const patch = (key, value) => setDraft((current) => ({ ...current, [key]: value }))
      function commit() {
        const normalized = normalizeSettings(draft)
        setError(normalized.error)
        if (normalized.error) return
        saveSettings(normalized.settings)
        setPage('show')
      }
      function onPointerDown(event) {
        if (event.button !== 0) return
        const rect = rootRef.current.getBoundingClientRect()
        dragRef.current = { id: event.pointerId, dx: event.clientX - rect.left, dy: event.clientY - rect.top, moved: false, x: rect.left, y: rect.top }
        event.currentTarget.setPointerCapture(event.pointerId)
      }
      function onPointerMove(event) {
        const drag = dragRef.current
        if (!drag || drag.id !== event.pointerId) return
        const x = event.clientX - drag.dx
        const y = event.clientY - drag.dy
        if (Math.abs(x - drag.x) + Math.abs(y - drag.y) > 4) drag.moved = true
        setPos({ x, y })
      }
      function onPointerUp(event) {
        if (dragRef.current?.id === event.pointerId) dragRef.current = null
      }
      const open = page !== 'closed'
      return h('div', { ref: rootRef, className: 'ww', style: pos ? { left: pos.x, top: pos.y, right: 'auto', bottom: 'auto' } : undefined },
        h('style', null, css),
        h('div', { className: 'ww-shell' },
          h('div', { className: 'ww-bar', title: '拖动可换位置', onPointerDown, onPointerMove, onPointerUp },
            h('span', null, view.status), h('b', null, formatMoney(view.today)), h('span', { className: 'ww-grow' }),
            h('button', { type: 'button', className: 'ww-nav', onPointerDown: (event) => event.stopPropagation(), onClick: () => setPage(open ? 'closed' : 'show') }, open ? '收起' : '展开')),
          open && page === 'show' ? h('div', { className: 'ww-body' },
            h('p', { className: 'ww-kicker' }, '今日已赚'),
            h('p', { className: 'ww-money' }, formatMoney(view.today)),
            h('p', { className: 'ww-count' }, view.countdownLabel, ' ', h('b', null, view.countdown), view.weekLabel ? ` · ${view.weekLabel}` : ''),
            h('div', { className: 'ww-split' },
              h('div', null, h('span', null, '每秒'), h('b', null, formatMoney(view.perSecond))),
              h('div', null, h('span', null, '本月累计'), h('b', null, formatMoney(view.month)))),
            h('div', { className: 'ww-foot' },
              h('span', { className: 'ww-kicker' }, `${view.workdays} 个工作日`),
              h('button', { type: 'button', className: 'ww-quiet', onClick: () => setPage('settings') }, '设置'))) : null,
          open && page === 'settings' ? h('div', { className: 'ww-body' },
            h('div', { className: 'ww-section' }, '时间'),
            h('div', { className: 'ww-grid' },
              h(Field, { label: '上班', type: 'time', value: draft.start, onChange: (value) => patch('start', value) }),
              h(Field, { label: '下班', type: 'time', value: draft.end, onChange: (value) => patch('end', value) }),
              h(Field, { label: '午休开始', type: 'time', value: draft.lunchStart, onChange: (value) => patch('lunchStart', value) }),
              h(Field, { label: '午休结束', type: 'time', value: draft.lunchEnd, onChange: (value) => patch('lunchEnd', value) })),
            h('div', { className: 'ww-section' }, '薪资'),
            h(Field, { label: '月薪（元）', value: String(draft.salary), onChange: (value) => patch('salary', value), wide: true }),
            h('div', { className: 'ww-section' }, '休息'),
            h(Choice, { value: draft.restMode, onChange: (value) => patch('restMode', value), options: [{ value: 'double', label: '双休' }, { value: 'single', label: '单休' }, { value: 'alternate', label: '大小周' }] }),
            draft.restMode === 'alternate' ? h('div', { className: 'ww-section' }, '本周') : null,
            draft.restMode === 'alternate' ? h(Choice, { value: draft.anchorWeek, onChange: (value) => patch('anchorWeek', value), options: [{ value: 'small', label: '小周' }, { value: 'big', label: '大周' }] }) : null,
            error ? h('p', { className: 'ww-error' }, error) : null,
            h('div', { className: 'ww-foot' },
              h('button', { type: 'button', className: 'ww-quiet', onClick: () => { setDraft(saved); setError(''); setPage('show') } }, '返回'),
              h('button', { type: 'button', className: 'ww-save', onClick: commit }, '保存'))) : null))
    }
    return { inject: ['slots'], apply(ctx) { ctx.slots.inject('shell.overlay', () => ctx.slots.register({ name: 'shell.overlay', id: 'work-wage', order: 30, label: '上班计费' }, Widget)) } }

  },
})
