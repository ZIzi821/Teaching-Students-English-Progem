const WEEKDAY_LABELS = Object.freeze(["周一", "周二", "周三", "周四", "周五", "周六", "周日"]);

const getMonday = (value = new Date()) => {
  const date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  const jsDay = date.getDay();
  const weekday = jsDay === 0 ? 7 : jsDay;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() - weekday + 1);
};

const buildWeekDays = (value = new Date()) => {
  const today = value instanceof Date ? new Date(value.getTime()) : new Date(value);
  const todayKey = `${today.getFullYear()}-${today.getMonth()}-${today.getDate()}`;
  const monday = getMonday(today);
  return WEEKDAY_LABELS.map((label, index) => {
    const date = new Date(monday.getFullYear(), monday.getMonth(), monday.getDate() + index);
    const dateLabel = `${date.getMonth() + 1}月${date.getDate()}日`;
    const dateKey = `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    return {
      weekday: index + 1,
      short: label.slice(1),
      label,
      dateLabel,
      fullLabel: `${label} · ${dateLabel}`,
      isToday: dateKey === todayKey,
      eventCount: 0,
    };
  });
};

module.exports = {
  WEEKDAY_LABELS,
  buildWeekDays,
  getMonday,
};
